use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use rustls::ClientConfig;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message};
use tokio_tungstenite::{
    connect_async_tls_with_config, Connector, MaybeTlsStream, WebSocketStream,
};

use crate::endpoint::Target;
use crate::status::Route;

pub(crate) type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// The largest websocket message accepted: one sealed link frame is at most 65535 bytes, and the
/// daemon's LAN listener takes 128 KiB.
const MAX_WIRE_MESSAGE: usize = 128 * 1024;
/// Sealed frames waiting for the writer; past it the engine holds the next one itself.
const OUT_FRAMES: usize = 64;

/// Why a dial opened no websocket.
#[derive(Debug)]
pub(crate) enum DialError {
    /// The server answered the upgrade with this HTTP status.
    Refused(StatusCode),
    Failed(String),
}

impl DialError {
    fn failed(error: impl ToString) -> DialError {
        DialError::Failed(error.to_string())
    }
}

impl fmt::Display for DialError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DialError::Refused(status) => write!(formatter, "refused with {status}"),
            DialError::Failed(reason) => formatter.write_str(reason),
        }
    }
}

/// Opens one websocket: DNS, TCP, TLS for `wss`, and the upgrade, all inside `within`.
pub(crate) async fn dial(
    target: &Target,
    tls: Arc<ClientConfig>,
    within: Duration,
) -> Result<WsStream, DialError> {
    let mut request = target
        .url
        .as_str()
        .into_client_request()
        .map_err(DialError::failed)?;
    for (name, value) in &target.headers {
        let value = HeaderValue::from_str(value).map_err(DialError::failed)?;
        request
            .headers_mut()
            .insert(HeaderName::from_static(name), value);
    }
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_WIRE_MESSAGE))
        .max_frame_size(Some(MAX_WIRE_MESSAGE));
    let connect =
        connect_async_tls_with_config(request, Some(config), true, Some(Connector::Rustls(tls)));
    match timeout(within, connect).await {
        Ok(Ok((stream, _))) => Ok(stream),
        Ok(Err(WsError::Http(response))) => Err(DialError::Refused(response.status())),
        Ok(Err(error)) => Err(DialError::failed(error)),
        Err(_) => Err(DialError::failed("timed out")),
    }
}

/// What the relay last said about the machine.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MachinePresence {
    Online,
    Offline,
    Asleep,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Presence {
    pub(crate) machine: MachinePresence,
    pub(crate) last_seen_ms: Option<u64>,
}

pub(crate) enum SocketEvent {
    Wire {
        id: u64,
        bytes: Bytes,
    },
    Presence {
        id: u64,
        presence: Presence,
    },
    /// `code` is the websocket close code the peer sent, if it sent one.
    Closed {
        id: u64,
        code: Option<u16>,
    },
}

/// One open websocket with a reader and a writer task. Dropping it ends both at once; `shut`
/// first lets the writer hand over what it holds.
pub(crate) struct Socket {
    pub(crate) id: u64,
    pub(crate) route: Route,
    pub(crate) detail: String,
    pub(crate) presence: Option<Presence>,
    /// Dialled with the one-time relay credentials of a pairing offer.
    pub(crate) pairing: bool,
    out: Option<mpsc::Sender<Vec<u8>>>,
    reader: JoinHandle<()>,
    writer: Option<JoinHandle<()>>,
}

impl Socket {
    pub(crate) fn spawn(
        id: u64,
        target: &Target,
        stream: WsStream,
        events: mpsc::Sender<SocketEvent>,
        pairing: bool,
    ) -> Socket {
        let (sink, source) = stream.split();
        let (out, frames) = mpsc::channel(OUT_FRAMES);
        Socket {
            id,
            route: target.route,
            detail: target.detail.clone(),
            presence: None,
            pairing,
            out: Some(out),
            reader: tokio::spawn(read(id, target.route, source, events)),
            writer: Some(tokio::spawn(write(sink, frames))),
        }
    }

    /// The writer's queue; `None` once `shut` started.
    pub(crate) fn out(&self) -> Option<&mpsc::Sender<Vec<u8>>> {
        self.out.as_ref()
    }

    /// Closes the queue, waits up to `within` for the writer to send what it holds and the close
    /// frame, then drops the socket.
    pub(crate) async fn shut(mut self, within: Duration) {
        self.out = None;
        if let Some(mut writer) = self.writer.take() {
            if timeout(within, &mut writer).await.is_err() {
                writer.abort();
            }
        }
    }
}

impl Drop for Socket {
    fn drop(&mut self) {
        self.reader.abort();
        if let Some(writer) = &self.writer {
            writer.abort();
        }
    }
}

async fn write(mut sink: SplitSink<WsStream, Message>, mut frames: mpsc::Receiver<Vec<u8>>) {
    while let Some(frame) = frames.recv().await {
        if sink.feed(Message::Binary(frame.into())).await.is_err() {
            return;
        }
        while let Ok(frame) = frames.try_recv() {
            if sink.feed(Message::Binary(frame.into())).await.is_err() {
                return;
            }
        }
        if sink.flush().await.is_err() {
            return;
        }
    }
    let _ = sink.close().await;
}

async fn read(
    id: u64,
    route: Route,
    mut source: SplitStream<WsStream>,
    events: mpsc::Sender<SocketEvent>,
) {
    let mut code = None;
    while let Some(message) = source.next().await {
        let event = match message {
            Ok(Message::Binary(bytes)) => SocketEvent::Wire { id, bytes },
            Ok(Message::Text(text)) if route == Route::Relay => match presence(&text) {
                Some(presence) => SocketEvent::Presence { id, presence },
                None => continue,
            },
            Ok(Message::Close(frame)) => {
                code = frame.map(|frame| u16::from(frame.code));
                break;
            }
            Ok(_) => continue,
            Err(_) => break,
        };
        if events.send(event).await.is_err() {
            return;
        }
    }
    let _ = events.send(SocketEvent::Closed { id, code }).await;
}

/// The relay's `{"t":"status","machine":…,"last_seen":…}`, or `None` for anything else.
fn presence(text: &str) -> Option<Presence> {
    let value: Value = serde_json::from_str(text).ok()?;
    if value.get("t")?.as_str()? != "status" {
        return None;
    }
    let machine = match value.get("machine")?.as_str()? {
        "online" => MachinePresence::Online,
        "offline" => MachinePresence::Offline,
        "asleep" => MachinePresence::Asleep,
        _ => return None,
    };
    Some(Presence {
        machine,
        last_seen_ms: value.get("last_seen").and_then(Value::as_u64),
    })
}

#[cfg(test)]
mod tests {
    use std::net::SocketAddr;

    use rustls::RootCertStore;
    use tokio::time::Instant;

    use super::*;
    use crate::tls;

    /// The real relay behind its own rustls listener with a throwaway certificate for 127.0.0.1.
    async fn tls_relay(dir: &std::path::Path) -> (SocketAddr, RootCertStore) {
        // axum-server asks rustls for the process default provider, which is ambiguous in a test
        // binary that links the daemon's and the relay's providers as well.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let certified =
            rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_owned()]).expect("cert");
        std::fs::write(dir.join("cert.pem"), certified.cert.pem()).expect("cert.pem");
        std::fs::write(dir.join("key.pem"), certified.signing_key.serialize_pem())
            .expect("key.pem");
        let hub = broski_relay::open(broski_relay::Options {
            db_path: dir.join("relay.db"),
            rate: broski_relay::limits::RateLimit::default(),
            limits: broski_relay::limits::Limits::default(),
            push: broski_relay::push::PushConfig::default(),
        })
        .await
        .expect("relay");
        let addr = std::net::TcpListener::bind("127.0.0.1:0")
            .expect("port")
            .local_addr()
            .expect("addr");
        let (cert, key) = (dir.join("cert.pem"), dir.join("key.pem"));
        tokio::spawn(broski_relay::serve_tls(
            addr,
            cert,
            key,
            hub,
            std::future::pending(),
        ));
        let mut roots = RootCertStore::empty();
        roots.add(certified.cert.der().clone()).expect("root");
        (addr, roots)
    }

    fn machine_socket(addr: SocketAddr) -> Target {
        Target {
            route: Route::Relay,
            url: format!("wss://{addr}/v1/machine"),
            headers: vec![
                (
                    "x-broski-machine",
                    "00112233445566778899aabbccddeeff".to_owned(),
                ),
                (
                    "authorization",
                    "Bearer AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8".to_owned(),
                ),
            ],
            detail: addr.ip().to_string(),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_wss_relay_is_dialled_over_ring_tls_and_an_untrusted_certificate_is_refused() {
        let dir = tempfile::tempdir().expect("dir");
        let (addr, roots) = tls_relay(dir.path()).await;
        let target = machine_socket(addr);
        let trusted = tls::with_roots(roots);
        let deadline = Instant::now() + Duration::from_secs(10);
        let stream = loop {
            match dial(&target, trusted.clone(), Duration::from_secs(5)).await {
                Ok(stream) => break stream,
                Err(error) => assert!(
                    Instant::now() < deadline,
                    "the wss dial never succeeded: {error}"
                ),
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert!(matches!(stream.get_ref(), MaybeTlsStream::Rustls(_)));

        let refused = dial(&target, tls::client_config(), Duration::from_secs(5)).await;
        let error =
            refused.expect_err("Mozilla's roots do not vouch for a self-signed certificate");
        assert!(
            error.to_string().to_lowercase().contains("certificate"),
            "{error}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_relay_refusing_a_device_token_is_a_401_not_a_string() {
        let dir = tempfile::tempdir().expect("dir");
        let (addr, roots) = tls_relay(dir.path()).await;
        let device = Target {
            route: Route::Relay,
            url: format!("wss://{addr}/v1/device"),
            headers: vec![
                (
                    "x-broski-machine",
                    "00112233445566778899aabbccddeeff".to_owned(),
                ),
                (
                    "x-broski-device",
                    "ffeeddccbbaa99887766554433221100".to_owned(),
                ),
                ("authorization", "Bearer unknown".to_owned()),
            ],
            detail: addr.ip().to_string(),
        };
        let trusted = tls::with_roots(roots);
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match dial(&device, trusted.clone(), Duration::from_secs(5)).await {
                Err(DialError::Refused(status)) => {
                    assert_eq!(status, StatusCode::UNAUTHORIZED);
                    return;
                }
                other => assert!(
                    Instant::now() < deadline,
                    "the relay never refused the device: {other:?}"
                ),
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[test]
    fn the_relay_status_frame_is_read_and_anything_else_is_not() {
        assert_eq!(
            presence(r#"{"t":"status","machine":"asleep","last_seen":17}"#),
            Some(Presence {
                machine: MachinePresence::Asleep,
                last_seen_ms: Some(17)
            })
        );
        assert_eq!(
            presence(r#"{"t":"status","machine":"online","last_seen":null}"#)
                .map(|presence| presence.last_seen_ms),
            Some(None)
        );
        for text in [
            r#"{"t":"status","machine":"gone"}"#,
            r#"{"t":"open"}"#,
            "[]",
            "x",
        ] {
            assert_eq!(presence(text), None, "{text}");
        }
    }
}
