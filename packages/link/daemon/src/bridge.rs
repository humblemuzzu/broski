use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tokio_tungstenite::WebSocketStream;
use tracing::{debug, warn};

use crate::bridge_status::BridgeMonitor;

/// Messages the session may write ahead to the bridge before it has to wait.
const OUTBOUND_QUEUE: usize = 64;
/// Messages read ahead of the session: with the session's read gate, this is all the daemon holds
/// for a bridge that keeps writing.
const INBOUND_QUEUE: usize = 4;
/// A bridge message has to fit the link's unacked window on its own, so the socket refuses more.
pub(crate) const LINK_MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
/// The whole dial: the unix connect plus the websocket upgrade.
pub(crate) const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the writer gets to give back what it did not write once the read side has ended.
const WRITER_DRAIN: Duration = Duration::from_secs(5);

const REQUEST: &str = "ws://localhost/v1/link";

type Sink = SplitSink<WebSocketStream<UnixStream>, Message>;
type Source = SplitStream<WebSocketStream<UnixStream>>;

pub enum BridgeIn {
    Ready,
    Message(Vec<u8>),
    /// The socket is gone; these messages were never written, oldest first.
    Closed {
        unsent: Vec<Vec<u8>>,
    },
}

pub struct BridgeLink {
    pub tx: mpsc::Sender<Vec<u8>>,
    pub rx: mpsc::Receiver<BridgeIn>,
}

/// Dials the bridge over its unix socket; the task exits when the socket dies.
pub fn spawn(
    socket: PathBuf,
    device_id: String,
    device_name: String,
    monitor: Arc<BridgeMonitor>,
) -> BridgeLink {
    let (tx, outbound) = mpsc::channel(OUTBOUND_QUEUE);
    let (inbound_tx, rx) = mpsc::channel(INBOUND_QUEUE);
    tokio::spawn(run(
        socket,
        device_id,
        device_name,
        outbound,
        inbound_tx,
        monitor,
    ));
    BridgeLink { tx, rx }
}

async fn run(
    socket: PathBuf,
    device_id: String,
    device_name: String,
    outbound: mpsc::Receiver<Vec<u8>>,
    inbound: mpsc::Sender<BridgeIn>,
    monitor: Arc<BridgeMonitor>,
) {
    let unsent = match dial(&socket, &device_id, &device_name).await {
        Some(socket) => {
            monitor.opened();
            let unsent = serve(socket, outbound, &inbound).await;
            monitor.closed();
            unsent
        }
        None => Vec::new(),
    };
    if inbound.send(BridgeIn::Closed { unsent }).await.is_err() {
        debug!("the session went away before the bridge reset was reported");
    }
}

/// One live socket: reports it ready, then pumps both directions until one of them ends.
async fn serve(
    socket: WebSocketStream<UnixStream>,
    outbound: mpsc::Receiver<Vec<u8>>,
    inbound: &mpsc::Sender<BridgeIn>,
) -> Vec<Vec<u8>> {
    if inbound.send(BridgeIn::Ready).await.is_err() {
        return Vec::new();
    }
    let (sink, source) = socket.split();
    let mut writer = tokio::spawn(write_loop(sink, outbound));
    let finished = tokio::select! {
        _ = read_loop(source, inbound) => None,
        finished = &mut writer => Some(finished),
    };
    match finished {
        Some(Ok(unsent)) => unsent,
        Some(Err(error)) => {
            warn!(error = %error, "bridge writer ended early");
            Vec::new()
        }
        None => drain_writer(&mut writer).await,
    }
}

/// The read side is gone, so the writer's next send fails on the dead socket. Waiting for that is
/// what gives back the messages it holds; a socket that never fails must not hold the session.
async fn drain_writer(writer: &mut JoinHandle<Vec<Vec<u8>>>) -> Vec<Vec<u8>> {
    match timeout(WRITER_DRAIN, &mut *writer).await {
        Ok(Ok(unsent)) => unsent,
        Ok(Err(error)) => {
            warn!(error = %error, "bridge writer ended early");
            Vec::new()
        }
        Err(_) => {
            writer.abort();
            warn!("bridge writer did not stop in time; its queued messages are lost");
            Vec::new()
        }
    }
}

/// The websocket upgrade over the bridge's unix socket, or `None` with the reason logged.
pub(crate) async fn dial(
    socket: &Path,
    device_id: &str,
    device_name: &str,
) -> Option<WebSocketStream<UnixStream>> {
    match timeout(DIAL_TIMEOUT, connect(socket, device_id, device_name)).await {
        Ok(socket) => socket,
        Err(_) => {
            debug!(socket = %socket.display(), "the bridge did not answer the dial in time");
            None
        }
    }
}

async fn connect(
    socket: &Path,
    device_id: &str,
    device_name: &str,
) -> Option<WebSocketStream<UnixStream>> {
    let mut request = REQUEST.into_client_request().ok()?;
    let headers = request.headers_mut();
    headers.insert("x-broski-device-id", HeaderValue::from_str(device_id).ok()?);
    headers.insert("x-broski-role", HeaderValue::from_static("owner"));
    if let Ok(name) = HeaderValue::from_str(device_name) {
        headers.insert("x-broski-device-name", name);
    }
    let Ok(stream) = UnixStream::connect(socket).await else {
        debug!(socket = %socket.display(), "bridge socket is not accepting connections");
        return None;
    };
    let config = WebSocketConfig::default()
        .max_message_size(Some(LINK_MAX_MESSAGE_BYTES))
        .max_frame_size(Some(LINK_MAX_MESSAGE_BYTES));
    match tokio_tungstenite::client_async_with_config(request, stream, Some(config)).await {
        Ok((socket, _)) => Some(socket),
        Err(error) => {
            debug!(socket = %socket.display(), error = %error, "bridge refused the websocket upgrade");
            None
        }
    }
}

/// Reads and writes in separate tasks, so a slow peer cannot stall the other direction. On the way
/// out it returns every message it did not write, the one that failed included.
async fn write_loop(mut sink: Sink, mut outbound: mpsc::Receiver<Vec<u8>>) -> Vec<Vec<u8>> {
    let mut unsent = Vec::new();
    while let Some(bytes) = outbound.recv().await {
        // The payload is kept so a write that fails can hand the message back.
        if let Err(error) = sink.send(to_message(bytes.clone())).await {
            warn!(error = %error, len = bytes.len(), "bridge refused a message");
            unsent.push(bytes);
            break;
        }
    }
    while let Ok(bytes) = outbound.try_recv() {
        unsent.push(bytes);
    }
    unsent
}

async fn read_loop(mut source: Source, inbound: &mpsc::Sender<BridgeIn>) {
    while let Some(message) = source.next().await {
        let message = match message {
            Ok(message) => message,
            Err(error) => {
                warn!(error = %error, "bridge socket ended");
                break;
            }
        };
        let bytes = match message {
            Message::Text(text) => text.as_bytes().to_vec(),
            Message::Binary(bytes) => bytes.to_vec(),
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
            Message::Close(frame) => {
                log_close(frame);
                break;
            }
        };
        if inbound.send(BridgeIn::Message(bytes)).await.is_err() {
            break;
        }
    }
}

fn log_close(frame: Option<CloseFrame>) {
    match frame {
        Some(frame) => {
            warn!(code = u16::from(frame.code), reason = %frame.reason, "bridge closed the socket")
        }
        None => warn!("bridge closed the socket without a code"),
    }
}

fn to_message(bytes: Vec<u8>) -> Message {
    match String::from_utf8(bytes) {
        Ok(text) => Message::Text(text.into()),
        Err(error) => Message::Binary(Bytes::from(error.into_bytes())),
    }
}
