use std::path::PathBuf;
use std::sync::Arc;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tokio_tungstenite::WebSocketStream;
use tracing::debug;

use crate::bridge_status::BridgeMonitor;

pub const QUEUE: usize = 64;

const REQUEST: &str = "ws://localhost/v1/link";

type Sink = SplitSink<WebSocketStream<UnixStream>, Message>;
type Source = SplitStream<WebSocketStream<UnixStream>>;

pub enum BridgeIn {
    Ready,
    Message(Vec<u8>),
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
    let (tx, outbound) = mpsc::channel(QUEUE);
    let (inbound_tx, rx) = mpsc::channel(QUEUE);
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
    let Some(socket) = dial(&socket, &device_id, &device_name).await else {
        return;
    };
    monitor.opened();
    if inbound.send(BridgeIn::Ready).await.is_err() {
        monitor.closed();
        return;
    }
    let (sink, source) = socket.split();
    let mut writer = tokio::spawn(write_loop(sink, outbound));
    tokio::select! {
        _ = read_loop(source, &inbound) => {}
        _ = &mut writer => {}
    }
    writer.abort();
    monitor.closed();
}

/// The websocket upgrade over the bridge's unix socket, or `None` with the reason logged.
pub(crate) async fn dial(
    socket: &std::path::Path,
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
    match tokio_tungstenite::client_async(request, stream).await {
        Ok((socket, _)) => Some(socket),
        Err(error) => {
            debug!(socket = %socket.display(), error = %error, "bridge refused the websocket upgrade");
            None
        }
    }
}

/// Reads and writes in separate tasks, so a slow peer cannot stall the other direction.
async fn write_loop(mut sink: Sink, mut outbound: mpsc::Receiver<Vec<u8>>) {
    while let Some(bytes) = outbound.recv().await {
        if sink.send(to_message(bytes)).await.is_err() {
            break;
        }
    }
}

async fn read_loop(mut source: Source, inbound: &mpsc::Sender<BridgeIn>) {
    while let Some(message) = source.next().await {
        let Ok(message) = message else {
            break;
        };
        let bytes = match message {
            Message::Text(text) => text.as_bytes().to_vec(),
            Message::Binary(bytes) => bytes.to_vec(),
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
            Message::Close(_) => break,
        };
        if inbound.send(BridgeIn::Message(bytes)).await.is_err() {
            break;
        }
    }
}

fn to_message(bytes: Vec<u8>) -> Message {
    match String::from_utf8(bytes) {
        Ok(text) => Message::Text(text.into()),
        Err(error) => Message::Binary(Bytes::from(error.into_bytes())),
    }
}
