use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::stream::SplitStream;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::bridge::Headers;
use super::header;

static NEXT: AtomicU64 = AtomicU64::new(1);

struct FeedSlot {
    id: u64,
    outbox: mpsc::UnboundedSender<String>,
}

/// The bridge's link socket as the daemon sees it: it records every connection and every text
/// frame, answers the feed's liveness and decision messages, and lets a test drive the feed.
pub struct FakeFeed {
    pub socket: PathBuf,
    sessions: Arc<Mutex<Vec<Headers>>>,
    received: Arc<Mutex<Vec<String>>>,
    feed: Arc<Mutex<Option<FeedSlot>>>,
    task: JoinHandle<()>,
}

impl FakeFeed {
    pub async fn start(socket: PathBuf) -> FakeFeed {
        let listener = UnixListener::bind(&socket).expect("bind the fake bridge");
        let sessions: Arc<Mutex<Vec<Headers>>> = Arc::new(Mutex::new(Vec::new()));
        let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let feed: Arc<Mutex<Option<FeedSlot>>> = Arc::new(Mutex::new(None));
        let task = tokio::spawn(accept(
            listener,
            Arc::clone(&sessions),
            Arc::clone(&received),
            Arc::clone(&feed),
        ));
        FakeFeed {
            socket,
            sessions,
            received,
            feed,
            task,
        }
    }

    pub fn connections(&self) -> Vec<Headers> {
        self.sessions
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    /// How many connections arrived with this `x-broski-role`.
    pub fn roles(&self, role: &str) -> usize {
        self.connections()
            .iter()
            .filter(|headers| header(headers, "x-broski-role").as_deref() == Some(role))
            .count()
    }

    pub fn device_of(&self, role: &str) -> Option<String> {
        self.connections()
            .iter()
            .find(|headers| header(headers, "x-broski-role").as_deref() == Some(role))
            .and_then(|headers| header(headers, "x-broski-device-id"))
    }

    /// Every text frame the daemon wrote, in arrival order.
    pub fn received(&self) -> Vec<String> {
        self.received
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn of_type(&self, kind: &str) -> Vec<Value> {
        self.received()
            .iter()
            .filter_map(|text| serde_json::from_str::<Value>(text).ok())
            .filter(|value| value["type"] == kind)
            .collect()
    }

    pub async fn await_feed(&self, budget: Duration) {
        let deadline = tokio::time::Instant::now() + budget;
        while self
            .feed
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_none()
        {
            assert!(
                tokio::time::Instant::now() < deadline,
                "the daemon never opened its feed socket"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    /// Drives the feed: `false` when the daemon is not attached right now.
    pub fn send(&self, value: Value) -> bool {
        let guard = self.feed.lock().unwrap_or_else(|error| error.into_inner());
        match guard.as_ref() {
            Some(slot) => slot.outbox.send(value.to_string()).is_ok(),
            None => false,
        }
    }

    /// Waits for a frame of `kind` the daemon wrote after the call.
    pub async fn await_of_type(&self, kind: &str, budget: Duration) -> Value {
        let seen = self.of_type(kind).len();
        let deadline = tokio::time::Instant::now() + budget;
        loop {
            let values = self.of_type(kind);
            if values.len() > seen {
                return values[seen].clone();
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "the daemon never wrote a {kind} frame; it wrote {:?}",
                self.received()
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Waits for the exact text the daemon wrote on a device socket.
    pub async fn await_text(&self, needle: &str, budget: Duration) {
        let deadline = tokio::time::Instant::now() + budget;
        while !self.received().iter().any(|text| text == needle) {
            assert!(
                tokio::time::Instant::now() < deadline,
                "the daemon never wrote {needle}; it wrote {:?}",
                self.received()
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// How many frames of `kind` exist after `within` of silence.
    pub async fn quiet(&self, kind: &str, within: Duration) -> usize {
        tokio::time::sleep(within).await;
        self.of_type(kind).len()
    }

    pub async fn stop(self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket);
    }
}

async fn accept(
    listener: UnixListener,
    sessions: Arc<Mutex<Vec<Headers>>>,
    received: Arc<Mutex<Vec<String>>>,
    feed: Arc<Mutex<Option<FeedSlot>>>,
) {
    // Dropping the set when `stop` aborts this task closes every connection with it.
    let mut connections = tokio::task::JoinSet::new();
    while let Ok((stream, _)) = listener.accept().await {
        let sessions = Arc::clone(&sessions);
        let received = Arc::clone(&received);
        let feed = Arc::clone(&feed);
        connections.spawn(async move { serve(stream, sessions, received, feed).await });
    }
}

#[allow(
    clippy::result_large_err,
    reason = "the upgrade callback signature is fixed by tungstenite"
)]
async fn serve(
    stream: UnixStream,
    sessions: Arc<Mutex<Vec<Headers>>>,
    received: Arc<Mutex<Vec<String>>>,
    feed: Arc<Mutex<Option<FeedSlot>>>,
) {
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let Some((captured, socket)) = upgrade(stream).await else {
        return;
    };

    let headers: Headers = {
        let guard = captured.lock().unwrap_or_else(|error| error.into_inner());
        guard.clone()
    };
    let is_feed = header(&headers, "x-broski-role").as_deref() == Some("link-daemon");
    sessions
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .push(headers.clone());

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if is_feed {
        *feed.lock().unwrap_or_else(|error| error.into_inner()) = Some(FeedSlot {
            id,
            outbox: tx.clone(),
        });
    }

    let (mut sink, mut source) = socket.split();
    let writer = async {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    };
    tokio::select! {
        () = drain(&mut source, &received, &tx) => {}
        () = writer => {}
    }
    if is_feed {
        let mut guard = feed.lock().unwrap_or_else(|error| error.into_inner());
        if guard.as_ref().is_some_and(|slot| slot.id == id) {
            *guard = None;
        }
    }
}

async fn drain(
    source: &mut SplitStream<WebSocketStream<UnixStream>>,
    received: &Mutex<Vec<String>>,
    replies: &mpsc::UnboundedSender<String>,
) {
    while let Some(message) = source.next().await {
        let Ok(message) = message else {
            break;
        };
        let text = match message {
            Message::Text(text) => text.as_str().to_owned(),
            Message::Binary(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
            Message::Close(_) => break,
        };
        received
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(text.clone());
        if let Some(reply) = reply(&text) {
            if replies.send(reply.to_string()).is_err() {
                break;
            }
        }
    }
}

#[allow(
    clippy::result_large_err,
    reason = "the upgrade callback signature is fixed by tungstenite"
)]
async fn upgrade(stream: UnixStream) -> Option<(Arc<Mutex<Headers>>, WebSocketStream<UnixStream>)> {
    let captured: Arc<Mutex<Headers>> = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&captured);
    let socket = tokio_tungstenite::accept_hdr_async(
        stream,
        move |request: &Request, response: Response| {
            let headers: Headers = request
                .headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_owned(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            *seen.lock().unwrap_or_else(|error| error.into_inner()) = headers;
            Ok(response)
        },
    )
    .await
    .ok()?;
    Some((captured, socket))
}

fn reply(text: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(text).ok()?;
    match value.get("type").and_then(Value::as_str)? {
        "link_feed_ping" => Some(json!({"type": "link_feed_pong"})),
        "link_decision" => Some(json!({
            "type": "link_decision_result",
            "request": value.get("request").cloned().unwrap_or(Value::Null),
            "ok": true,
            "error": Value::Null,
        })),
        _ => None,
    }
}
