use std::fmt;
use std::net::{IpAddr, Ipv6Addr, SocketAddr, SocketAddrV6};
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use rustls::ClientConfig;
use serde_json::Value;
use tokio::net::{TcpSocket, TcpStream};
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::{Bytes, Error as WsError, Message};
use tokio_tungstenite::{client_async_tls_with_config, Connector, MaybeTlsStream, WebSocketStream};

use crate::endpoint::Target;
use crate::segments;
use crate::status::Route;

pub(crate) type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// The largest websocket message accepted: one sealed link frame is at most 65535 bytes, and the
/// daemon's LAN listener takes 128 KiB.
const MAX_WIRE_MESSAGE: usize = 128 * 1024;
/// Sealed frames waiting for the writer; past it the engine holds the next one itself.
const OUT_FRAMES: usize = 64;
/// Cap per-flush batching so a multi-megabyte burst flushes incrementally and never traps urgent
/// keepalives or peer ACKs behind several megabytes of buffered frames.
const WRITE_FLUSH_BYTES: usize = 128 * 1024;

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
    let connect = async {
        let socket = open_tcp(target, &request).await?;
        client_async_tls_with_config(request, socket, Some(config), Some(Connector::Rustls(tls)))
            .await
            .map_err(|error| match error {
                WsError::Http(response) => DialError::Refused(response.status()),
                error => DialError::failed(error),
            })
    };
    match timeout(within, connect).await {
        Ok(Ok((stream, _))) => Ok(stream),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(DialError::failed("timed out")),
    }
}

async fn open_tcp(
    target: &Target,
    request: &tokio_tungstenite::tungstenite::handshake::client::Request,
) -> Result<TcpStream, DialError> {
    let uri = request.uri();
    let host = uri
        .host()
        .ok_or_else(|| DialError::failed("the address has no host"))?;
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    let port = match (uri.port_u16(), uri.scheme_str()) {
        (Some(port), _) => port,
        (None, Some("wss")) => 443,
        (None, Some("ws")) => 80,
        _ => return Err(DialError::failed("the address is not ws or wss")),
    };
    connect_tcp(
        host,
        port,
        target.zone.as_deref(),
        target.route == Route::Lan,
    )
    .await
}

/// Connects TCP to `host:port`, resolving an IPv6 link-local `zone` via `if_nametoindex`,
/// skipping non-routable CLAT46 (`192.0.0.0/29`) on LAN lookups, and racing multiple resolved
/// addresses concurrently so one blackholed address never stalls a working IPv6/IPv4 path.
pub(crate) async fn connect_tcp(
    host: &str,
    port: u16,
    zone: Option<&str>,
    lan: bool,
) -> Result<TcpStream, DialError> {
    if let Some(zone) = zone {
        if let Ok(ip) = host.parse::<Ipv6Addr>() {
            let scope_id = resolve_scope_id(zone)
                .ok_or_else(|| DialError::failed(format!("unknown interface {zone}")))?;
            return connect_capped(SocketAddr::V6(SocketAddrV6::new(ip, port, 0, scope_id)))
                .await
                .map_err(DialError::failed);
        }
    }
    let resolved: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(DialError::failed)?
        .filter(|addr| !(lan && is_clat46(addr.ip())))
        .collect();
    match resolved.as_slice() {
        [] => Err(DialError::failed("the address did not resolve")),
        [only] => connect_capped(*only).await.map_err(DialError::failed),
        many => race_connect(many).await,
    }
}

async fn race_connect(addresses: &[SocketAddr]) -> Result<TcpStream, DialError> {
    let mut dials = JoinSet::new();
    for &address in addresses {
        dials.spawn(connect_capped(address));
    }
    let mut failure = DialError::failed("connection failed");
    while let Some(result) = dials.join_next().await {
        match result {
            Ok(Ok(stream)) => {
                dials.abort_all();
                return Ok(stream);
            }
            Ok(Err(error)) => failure = DialError::failed(error),
            Err(_) => {}
        }
    }
    Err(failure)
}

fn is_clat46(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(addr) => {
            let [a, b, c, d] = addr.octets();
            a == 192 && b == 0 && c == 0 && d <= 7
        }
        IpAddr::V6(_) => false,
    }
}

fn resolve_scope_id(zone: &str) -> Option<u32> {
    if let Ok(index) = zone.parse::<u32>() {
        return (index > 0).then_some(index);
    }
    #[cfg(unix)]
    {
        let c_name = std::ffi::CString::new(zone).ok()?;
        // SAFETY: `c_name` is a valid NUL-terminated C string.
        let index = unsafe { libc::if_nametoindex(c_name.as_ptr()) };
        (index > 0).then_some(index)
    }
    #[cfg(not(unix))]
    {
        None
    }
}

async fn connect_capped(address: SocketAddr) -> std::io::Result<TcpStream> {
    let socket = if address.is_ipv4() {
        TcpSocket::new_v4()?
    } else {
        TcpSocket::new_v6()?
    };
    segments::clamp(&socket);
    socket.set_nodelay(true)?;
    let stream = socket.connect(address).await?;
    segments::clamp(&stream);
    Ok(stream)
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
        let mut batched = frame.len();
        if sink.feed(Message::Binary(frame.into())).await.is_err() {
            return;
        }
        while batched < WRITE_FLUSH_BYTES {
            let Ok(frame) = frames.try_recv() else { break };
            batched += frame.len();
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
            zone: None,
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
            zone: None,
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

    #[tokio::test]
    async fn a_dialled_socket_sends_segments_no_larger_than_the_cap() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let url = format!("ws://{addr}/");
        let target = Target {
            route: Route::Lan,
            url: url.clone(),
            headers: Vec::new(),
            detail: addr.to_string(),
            zone: None,
        };
        let request = url.as_str().into_client_request().expect("request");
        let (socket, accepted) = tokio::join!(open_tcp(&target, &request), listener.accept());
        let (socket, _) = (socket.expect("connected"), accepted.expect("accepted"));
        assert!(socket.nodelay().expect("nodelay"));
        assert!(segments::max_segment(&socket) <= segments::MAX_SEGMENT);
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
