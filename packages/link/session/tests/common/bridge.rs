use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{UnixListener, UnixStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;

pub type Headers = Vec<(String, String)>;

#[derive(Default)]
struct Seen {
    sessions: Vec<Headers>,
    received: Vec<String>,
    decisions: Vec<Value>,
}

/// A stand-in for the Bun bridge on the daemon's unix socket: a device session's frames come back
/// as `echo:<frame>`, and the daemon's feed is answered as the bridge answers it — pings with a
/// pong, a lock-screen decision with an accepted result.
pub struct BridgeStandIn {
    seen: Arc<Mutex<Seen>>,
    task: JoinHandle<()>,
}

impl BridgeStandIn {
    pub fn start(socket: &Path) -> BridgeStandIn {
        let listener = UnixListener::bind(socket).expect("bind the bridge socket");
        let seen = Arc::new(Mutex::new(Seen::default()));
        let accepted = Arc::clone(&seen);
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve(stream, Arc::clone(&accepted)));
            }
        });
        BridgeStandIn { seen, task }
    }

    /// The headers of every device session the daemon opened, in order.
    pub fn sessions(&self) -> Vec<Headers> {
        locked(&self.seen).sessions.clone()
    }

    /// Every frame a device session wrote, in arrival order.
    pub fn received(&self) -> Vec<String> {
        locked(&self.seen).received.clone()
    }

    /// Every `link_decision` the daemon's feed delivered.
    pub fn decisions(&self) -> Vec<Value> {
        locked(&self.seen).decisions.clone()
    }

    pub fn stop(self) {
        self.task.abort();
    }
}

pub fn header(headers: &Headers, name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
}

fn locked(seen: &Mutex<Seen>) -> MutexGuard<'_, Seen> {
    seen.lock().unwrap_or_else(PoisonError::into_inner)
}

#[allow(
    clippy::result_large_err,
    reason = "the upgrade callback signature is fixed by tungstenite"
)]
async fn serve(stream: UnixStream, seen: Arc<Mutex<Seen>>) {
    let captured = Arc::new(Mutex::new(Headers::new()));
    let headers = Arc::clone(&captured);
    let callback = move |request: &Request, response: Response| {
        *headers.lock().unwrap_or_else(PoisonError::into_inner) = request
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or_default().to_owned(),
                )
            })
            .collect();
        Ok(response)
    };
    let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, callback).await else {
        return;
    };
    let headers = captured
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    let feed = header(&headers, "x-broski-role").as_deref() == Some("link-daemon");
    if !feed {
        locked(&seen).sessions.push(headers);
    }
    let (mut sink, mut source) = socket.split();
    while let Some(Ok(message)) = source.next().await {
        let text = match message {
            Message::Text(text) => text.as_str().to_owned(),
            Message::Binary(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Message::Close(_) => break,
            _ => continue,
        };
        let reply = if feed {
            feed_reply(&text, &seen)
        } else {
            locked(&seen).received.push(text.clone());
            Some(format!("echo:{text}"))
        };
        if let Some(reply) = reply {
            if sink.send(Message::Text(reply.into())).await.is_err() {
                break;
            }
        }
    }
}

fn feed_reply(text: &str, seen: &Mutex<Seen>) -> Option<String> {
    let message: Value = serde_json::from_str(text).ok()?;
    match message["type"].as_str()? {
        "link_feed_ping" => Some(json!({"type": "link_feed_pong"}).to_string()),
        "link_decision" => {
            let request = message["request"].clone();
            locked(seen).decisions.push(message);
            Some(json!({"type": "link_decision_result", "request": request, "ok": true, "error": null}).to_string())
        }
        _ => None,
    }
}
