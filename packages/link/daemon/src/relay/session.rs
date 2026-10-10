use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tracing::{debug, warn};
use zeroize::Zeroizing;

use crate::codec;
use crate::conn::{self, ConnOut, Route};
use crate::device::short;
use crate::letters;
use crate::responder::Responder;

use super::Config;

const OUTBOX: usize = 256;
const PATH: &str = "/v1/machine";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub(super) struct Session {
    pub(super) stream: SplitStream<Socket>,
    outbox: mpsc::Sender<Message>,
    writer: JoinHandle<()>,
    channels: HashMap<u32, mpsc::Sender<Vec<u8>>>,
    drains: Vec<JoinHandle<()>>,
    letters: mpsc::Sender<letters::Incoming>,
    /// One request-id sequence for every message this machine socket carries.
    next_req: Arc<AtomicU64>,
}

impl Session {
    pub(super) async fn request(&mut self, mut message: serde_json::Value) -> bool {
        message["req"] = serde_json::Value::from(self.next_req.fetch_add(1, Ordering::Relaxed));
        self.send(message).await
    }

    pub(super) async fn send(&mut self, message: serde_json::Value) -> bool {
        let text = match serde_json::to_string(&message) {
            Ok(text) => text,
            Err(error) => {
                warn!(error = %error, "relay control message not encoded");
                return true;
            }
        };
        match timeout(SEND_TIMEOUT, self.outbox.send(Message::Text(text.into()))).await {
            Ok(Ok(())) => true,
            Ok(Err(_)) | Err(_) => false,
        }
    }

    /// Unparseable or unhandled control messages are ignored, never fatal.
    pub(super) async fn control(&mut self, text: &str, responder: &Arc<Responder>) {
        let Ok(message) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        match message.get("t").and_then(|tag| tag.as_str()) {
            Some("open") => {
                let channel = message.get("ch").and_then(|ch| ch.as_u64());
                let device = message.get("device").and_then(|device| device.as_str());
                if let (Some(channel), Some(device)) = (channel, device) {
                    if let Ok(channel) = u32::try_from(channel) {
                        debug!(channel, device = short(device), "relay channel opened");
                        self.open(channel, device, responder);
                    }
                }
            }
            Some("close") => {
                if let Some(channel) = message.get("ch").and_then(|ch| ch.as_u64()) {
                    if let Ok(channel) = u32::try_from(channel) {
                        self.channels.remove(&channel);
                    }
                }
            }
            Some("err") => {
                let code = message
                    .get("code")
                    .and_then(|code| code.as_str())
                    .unwrap_or("unknown");
                warn!(code, "relay rejected a request");
            }
            Some("letter") => self.letter(&message).await,
            // ok and anything a newer relay adds are ignored here
            _ => {}
        }
    }

    /// Hands the letter to the letters task; a queue that is full leaves it for the relay to
    /// redeliver, and one missing its fields is acked so it is not redelivered forever.
    async fn letter(&mut self, message: &serde_json::Value) {
        let Some(id) = message.get("id").and_then(|id| id.as_u64()) else {
            return;
        };
        let device = message.get("device").and_then(|device| device.as_str());
        let data = message.get("data").and_then(|data| data.as_str());
        let Some((device, data)) = device.zip(data) else {
            self.ack(id).await;
            return;
        };
        let incoming = letters::Incoming {
            id,
            device: device.to_owned(),
            data: data.to_owned(),
        };
        if self.letters.try_send(incoming).is_err() {
            warn!(letter = id, "letter queue is full; leaving it to the relay");
        }
    }

    async fn ack(&mut self, id: u64) {
        self.send(json!({"t": "letter_ack", "id": id})).await;
    }

    fn open(&mut self, channel: u32, device: &str, responder: &Arc<Responder>) {
        if self.channels.contains_key(&channel) {
            return;
        }
        self.drains.retain(|drain| !drain.is_finished());
        let parts = conn::channel(Route::Relay { channel }, Some(device.to_owned()));
        let outbox = self.outbox.clone();
        let requests = Arc::clone(&self.next_req);
        let drain = tokio::spawn(async move {
            let mut outbound = parts.outbound;
            while let Some(out) = outbound.recv().await {
                let queued = match out {
                    ConnOut::Wire(bytes) => {
                        let mut frame = Vec::with_capacity(4 + bytes.len());
                        frame.extend_from_slice(&channel.to_be_bytes());
                        frame.extend_from_slice(&bytes);
                        outbox.send(Message::Binary(frame.into())).await
                    }
                    ConnOut::Revoke(device) => match revoke_text(&device, &requests) {
                        Some(text) => outbox.send(Message::Text(text.into())).await,
                        None => Ok(()),
                    },
                    ConnOut::Close => break,
                };
                if queued.is_err() {
                    break;
                }
            }
        });
        self.channels.insert(channel, parts.inbound_tx);
        self.drains.push(drain);
        let responder = responder.clone();
        tokio::spawn(async move { responder.run(parts.conn).await });
    }

    pub(super) fn forward(&mut self, frame: &[u8]) {
        let Some((header, payload)) = frame.split_at_checked(4) else {
            return;
        };
        let channel = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let Some(inbound) = self.channels.get(&channel) else {
            return;
        };
        if inbound.try_send(payload.to_vec()).is_err() {
            self.channels.remove(&channel);
        }
    }

    pub(super) async fn teardown(&mut self) {
        self.channels.clear();
        for drain in self.drains.drain(..) {
            drain.abort();
        }
        self.writer.abort();
    }
}

pub(super) async fn connect(config: &Config) -> Result<Session, Fail> {
    let mut request = endpoint(&config.url).into_client_request()?;
    let headers = request.headers_mut();
    let machine = HeaderValue::from_str(&config.machine_id)?;
    let token = Zeroizing::new(format!("Bearer {}", codec::b64url(&config.secret)));
    let bearer = HeaderValue::from_str(&token)?;
    headers.insert("x-broski-machine", machine);
    headers.insert("authorization", bearer);

    let (socket, _) = timeout(CONNECT_TIMEOUT, connect_async(request))
        .await
        .map_err(|_| Fail::Timeout)??;

    let (sink, stream) = socket.split();
    let (outbox, receiver) = mpsc::channel(OUTBOX);
    let writer = tokio::spawn(write_loop(sink, receiver));
    let mut session = Session {
        stream,
        outbox,
        writer,
        channels: HashMap::new(),
        drains: Vec::new(),
        letters: config.letters.clone(),
        next_req: Arc::new(AtomicU64::new(1)),
    };
    if !session
        .request(json!({"t": "identity", "pub": config.public}))
        .await
    {
        session.teardown().await;
        return Err(Fail::Closed);
    }
    Ok(session)
}

pub(super) enum Fail {
    Ws(WsError),
    Header,
    Timeout,
    Closed,
}

impl From<WsError> for Fail {
    fn from(error: WsError) -> Self {
        Fail::Ws(error)
    }
}

impl From<tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue> for Fail {
    fn from(_: tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue) -> Self {
        Fail::Header
    }
}

impl std::fmt::Display for Fail {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fail::Ws(error) => write!(formatter, "{error}"),
            Fail::Header => formatter.write_str("relay credentials are not valid header values"),
            Fail::Timeout => formatter.write_str("relay handshake timed out"),
            Fail::Closed => formatter.write_str("relay socket closed during the handshake"),
        }
    }
}

type Sink = futures_util::stream::SplitSink<Socket, Message>;

fn revoke_text(device: &str, requests: &AtomicU64) -> Option<String> {
    let req = requests.fetch_add(1, Ordering::Relaxed);
    serde_json::to_string(&json!({"t": "revoke", "device": device, "req": req})).ok()
}

async fn write_loop(mut sink: Sink, mut receiver: mpsc::Receiver<Message>) {
    while let Some(message) = receiver.recv().await {
        if sink.send(message).await.is_err() {
            break;
        }
    }
}

/// A relay url with no path is dialled at `/v1/machine`; a url with a path is used as given.
fn endpoint(base: &str) -> String {
    let authority = base.find("://").map_or(0, |index| index + 3);
    let base = base.trim_end_matches('/');
    if base[authority..].contains('/') {
        base.to_owned()
    } else {
        format!("{base}{PATH}")
    }
}
