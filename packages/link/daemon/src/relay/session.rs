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
/// How long one frame waits for room in a channel's queue before the channel is closed. A phone
/// that is slow keeps its channel; a phone that has stopped reading loses it, and the relay is
/// told so it can close the device's side too.
const FORWARD_TIMEOUT: Duration = Duration::from_secs(10);

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

    /// One frame from the relay for one of its channels. Waits for room in the channel's queue
    /// instead of dropping the channel on the first full one: only a channel that has taken
    /// nothing for `FORWARD_TIMEOUT` is closed, and the relay is told to close it too.
    pub(super) async fn forward(&mut self, frame: &[u8]) {
        let Some((channel, payload)) = split(frame) else {
            return;
        };
        match forward(&mut self.channels, channel, payload, FORWARD_TIMEOUT).await {
            Arrived::Delivered | Arrived::Gone => {}
            Arrived::Stuck => {
                warn!(channel, "the device channel is not draining; closing it");
                self.send(json!({ "t": "close", "ch": channel })).await;
            }
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
    let url = endpoint(&config.url);
    if !is_safe_relay_url(&url) {
        return Err(Fail::InsecureUrl);
    }
    let mut request = url.into_client_request()?;
    let headers = request.headers_mut();
    let machine = HeaderValue::from_str(&config.machine_id)?;
    let token = Zeroizing::new(format!("Bearer {}", codec::b64url(&config.secret)));
    let bearer = HeaderValue::from_str(&token)?;
    headers.insert("x-broski-machine", machine);
    headers.insert("authorization", bearer);
    if let Some(token) = &config.register_token {
        headers.insert("x-broski-register-token", HeaderValue::from_str(token)?);
    }

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

/// What became of one frame the relay handed over for a channel.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Arrived {
    Delivered,
    /// The channel was already gone.
    Gone,
    /// The channel took nothing for the whole window and has been closed.
    Stuck,
}

fn split(frame: &[u8]) -> Option<(u32, &[u8])> {
    let (header, payload) = frame.split_at_checked(4)?;
    let channel = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    Some((channel, payload))
}

async fn forward(
    channels: &mut HashMap<u32, mpsc::Sender<Vec<u8>>>,
    channel: u32,
    payload: &[u8],
    window: Duration,
) -> Arrived {
    let Some(inbound) = channels.get(&channel).cloned() else {
        return Arrived::Gone;
    };
    match timeout(window, inbound.send(payload.to_vec())).await {
        Ok(Ok(())) => Arrived::Delivered,
        Ok(Err(_)) => {
            channels.remove(&channel);
            Arrived::Gone
        }
        Err(_) => {
            channels.remove(&channel);
            Arrived::Stuck
        }
    }
}

pub(super) enum Fail {
    Ws(WsError),
    Header,
    InsecureUrl,
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
            Fail::InsecureUrl => {
                formatter.write_str("refusing cleartext ws:// relay url for a non-loopback host")
            }
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

/// Refuses plaintext `ws://` (and `http://`) to non-loopback hosts so the machine's
/// 32-byte relay bearer secret is never transmitted unencrypted over a network.
fn is_safe_relay_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("wss://") {
        return true;
    }
    let Some(rest) = lower.strip_prefix("ws://") else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or("");
    let host = if authority.starts_with('[') {
        authority
            .split(']')
            .next()
            .unwrap_or("")
            .trim_start_matches('[')
    } else {
        authority.split(':').next().unwrap_or("")
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A channel with room is served at once, the next frame is waited on instead of being
    /// dropped with the channel, and only a channel that stays full for the whole window is
    /// closed — which is what makes the caller tell the relay.
    #[tokio::test]
    async fn a_full_channel_is_waited_on_and_closed_only_when_the_window_runs_out() {
        let (tx, mut rx) = mpsc::channel(2);
        let mut channels: HashMap<u32, mpsc::Sender<Vec<u8>>> = HashMap::new();
        channels.insert(7, tx);
        for held in [b"held".to_vec(), b"held".to_vec()] {
            channels
                .get(&7)
                .expect("a channel")
                .try_send(held)
                .expect("room for the queue");
        }
        assert_eq!(
            forward(&mut channels, 7, b"third", Duration::from_millis(50)).await,
            Arrived::Stuck,
            "a channel that never drains is closed"
        );
        assert!(!channels.contains_key(&7));
        assert_eq!(rx.recv().await.expect("the first frame"), b"held".to_vec());
    }

    #[tokio::test]
    async fn a_channel_with_room_takes_the_frame() {
        let (tx, mut rx) = mpsc::channel(2);
        let mut channels: HashMap<u32, mpsc::Sender<Vec<u8>>> = HashMap::new();
        channels.insert(7, tx);
        assert_eq!(
            forward(&mut channels, 7, b"frame", Duration::from_millis(50)).await,
            Arrived::Delivered
        );
        assert!(channels.contains_key(&7), "the channel is still open");
        assert_eq!(rx.recv().await.expect("the frame"), b"frame".to_vec());
    }

    #[tokio::test]
    async fn a_frame_for_a_channel_that_is_gone_is_dropped_quietly() {
        let mut channels: HashMap<u32, mpsc::Sender<Vec<u8>>> = HashMap::new();
        assert_eq!(
            forward(&mut channels, 9, b"x", Duration::from_millis(10)).await,
            Arrived::Gone
        );
    }

    #[tokio::test]
    async fn a_frame_too_short_to_name_a_channel_is_ignored() {
        assert!(split(&[0, 1]).is_none());
        assert_eq!(
            split(&[0, 0, 0, 7, 9]).map(|(channel, payload)| (channel, payload.to_vec())),
            Some((7, vec![9]))
        );
    }
}
