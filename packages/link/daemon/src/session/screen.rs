use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::Duration;

use broski_screen::{ClientTunnelMsg, ScreenCloseReason, ServerTunnelMsg, MAX_TUNNEL_CHUNK};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tracing::debug;

use super::Input;

const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
const OUT_QUEUE: usize = 256;
const IN_QUEUE: usize = 4;

pub(super) enum ScreenIn {
    Message(Vec<u8>),
    Ended(u32),
}

struct AbortOnDrop(JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Manages one device session's loopback TCP tunnel to macOS Screen Sharing (`127.0.0.1:<port>`).
pub(super) struct ScreenPump {
    port: u16,
    active: Option<ActiveTunnel>,
}

struct ActiveTunnel {
    session_id: u32,
    to_server: mpsc::Sender<Vec<u8>>,
    from_server: mpsc::Receiver<ScreenIn>,
    _task: AbortOnDrop,
}

impl ScreenPump {
    pub(super) fn new(port: u16) -> Self {
        Self { port, active: None }
    }

    /// Processes one phone→Mac tunnel frame. Returns a `Closed` frame for the phone if the
    /// phone→Mac input queue overflows rather than dropping an RFB message silently.
    pub(super) fn handle_client(&mut self, bytes: &[u8]) -> Option<Vec<u8>> {
        let msg = ClientTunnelMsg::decode(bytes)?;
        match msg {
            ClientTunnelMsg::Open { session_id } => {
                debug!(session_id, port = self.port, "screen tunnel open");
                self.open(session_id);
                None
            }
            ClientTunnelMsg::Data {
                session_id,
                payload,
            } => self.forward_client_data(session_id, payload),
            ClientTunnelMsg::Close { session_id } => {
                debug!(session_id, "screen tunnel close");
                if self.matches(session_id) {
                    self.close();
                }
                None
            }
        }
    }

    pub(super) fn refuse_disabled(&mut self, bytes: &[u8]) -> Option<Vec<u8>> {
        match ClientTunnelMsg::decode(bytes)? {
            ClientTunnelMsg::Open { session_id } => Some(
                ServerTunnelMsg::Closed {
                    session_id,
                    reason: ScreenCloseReason::ScreenSharingDisabled,
                    detail: "Turn on Experimental → Remote Mac Screen in Broski Settings."
                        .to_owned(),
                }
                .encode(),
            ),
            _ => None,
        }
    }

    pub(super) fn close(&mut self) {
        self.active = None;
    }

    pub(super) fn ended(&mut self, session_id: u32) {
        if self.matches(session_id) {
            self.active = None;
        }
    }

    fn matches(&self, session_id: u32) -> bool {
        self.active
            .as_ref()
            .is_some_and(|a| a.session_id == session_id)
    }

    fn forward_client_data(&mut self, session_id: u32, payload: Vec<u8>) -> Option<Vec<u8>> {
        let active = self.active.as_ref()?;
        if active.session_id != session_id {
            return None;
        }
        if active.to_server.try_send(payload).is_ok() {
            return None;
        }
        debug!(session_id, "screen client input queue overflowed; closing");
        self.close();
        Some(closed_frame(
            session_id,
            ScreenCloseReason::ProtocolError,
            "Screen input queue overflowed".to_owned(),
        ))
    }

    fn open(&mut self, session_id: u32) {
        self.close();
        let port = self.port;
        let (to_server, from_client) = mpsc::channel(OUT_QUEUE);
        let (to_actor, from_server) = mpsc::channel(IN_QUEUE);
        let handle = tokio::spawn(run_tunnel(session_id, port, from_client, to_actor));
        self.active = Some(ActiveTunnel {
            session_id,
            to_server,
            from_server,
            _task: AbortOnDrop(handle),
        });
    }
}

/// Polls the screen tunnel's outbound frames only when `gate_open` is true, so screen traffic
/// never starves `STREAM_BRIDGE` or overflows the link window.
pub(super) async fn input(pump: &mut ScreenPump, gate_open: bool) -> Input {
    if !gate_open {
        return std::future::pending().await;
    }
    let Some(active) = pump.active.as_mut() else {
        return std::future::pending().await;
    };
    match active.from_server.recv().await {
        Some(msg) => Input::Screen(msg),
        None => Input::Screen(ScreenIn::Ended(active.session_id)),
    }
}

async fn run_tunnel(
    session_id: u32,
    port: u16,
    from_client: mpsc::Receiver<Vec<u8>>,
    to_actor: mpsc::Sender<ScreenIn>,
) {
    let stream = match dial_screen(port).await {
        Ok(stream) => stream,
        Err((reason, detail)) => {
            let _ = to_actor
                .send(ScreenIn::Message(closed_frame(session_id, reason, detail)))
                .await;
            return;
        }
    };
    let _ = stream.set_nodelay(true);
    let opened = ServerTunnelMsg::Opened { session_id }.encode();
    if to_actor.send(ScreenIn::Message(opened)).await.is_err() {
        return;
    }

    let (reader, writer) = stream.into_split();
    let _writer_guard = AbortOnDrop(tokio::spawn(write_loop(writer, from_client)));
    let (reason, detail) = read_loop(session_id, reader, &to_actor).await;
    let _ = to_actor
        .send(ScreenIn::Message(closed_frame(session_id, reason, detail)))
        .await;
}

async fn dial_screen(port: u16) -> Result<TcpStream, (ScreenCloseReason, String)> {
    let _ = broski_link_power::wake_display("broski remote screen");
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    match timeout(DIAL_TIMEOUT, TcpStream::connect(addr)).await {
        Ok(Ok(stream)) => Ok(stream),
        Ok(Err(err)) if err.kind() == ErrorKind::ConnectionRefused => Err((
            ScreenCloseReason::ScreenSharingDisabled,
            "Enable Screen Sharing in System Settings → General → Sharing".to_owned(),
        )),
        Ok(Err(err)) => Err((ScreenCloseReason::Unavailable, err.to_string())),
        Err(_) => Err((
            ScreenCloseReason::Unavailable,
            "Timed out connecting to macOS Screen Sharing".to_owned(),
        )),
    }
}

async fn read_loop(
    session_id: u32,
    mut reader: OwnedReadHalf,
    to_actor: &mpsc::Sender<ScreenIn>,
) -> (ScreenCloseReason, String) {
    let mut buf = vec![0u8; MAX_TUNNEL_CHUNK];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => return (ScreenCloseReason::Normal, String::new()),
            Ok(n) => {
                let encoded = ServerTunnelMsg::Data {
                    session_id,
                    payload: buf[..n].to_vec(),
                }
                .encode();
                if to_actor.send(ScreenIn::Message(encoded)).await.is_err() {
                    return (ScreenCloseReason::Normal, String::new());
                }
            }
            Err(err) => {
                debug!(%err, "screen loopback read failed");
                return (ScreenCloseReason::Unavailable, err.to_string());
            }
        }
    }
}

async fn write_loop(mut writer: OwnedWriteHalf, mut from_client: mpsc::Receiver<Vec<u8>>) {
    while let Some(bytes) = from_client.recv().await {
        if let Err(err) = writer.write_all(&bytes).await {
            debug!(%err, "screen loopback write failed");
            break;
        }
    }
    let _ = writer.shutdown().await;
}

fn closed_frame(session_id: u32, reason: ScreenCloseReason, detail: String) -> Vec<u8> {
    ServerTunnelMsg::Closed {
        session_id,
        reason,
        detail,
    }
    .encode()
}
