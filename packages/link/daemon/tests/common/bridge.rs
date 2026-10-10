use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::header;

pub type Headers = Vec<(String, String)>;

/// A stand-in for the Bun bridge: real unix socket, real websocket, echoing text frames. Only the
/// connections that open as a device session (`x-broski-role: owner`) are recorded; the daemon's
/// own feed connection shares the socket but is not a session.
pub struct FakeBridge {
    pub socket: PathBuf,
    sessions: Arc<Mutex<Vec<Headers>>>,
    received: Arc<Mutex<Vec<String>>>,
    task: JoinHandle<()>,
}

impl FakeBridge {
    pub async fn start(socket: PathBuf) -> FakeBridge {
        let listener = UnixListener::bind(&socket).expect("bind fake bridge");
        let sessions: Arc<Mutex<Vec<Headers>>> = Arc::new(Mutex::new(Vec::new()));
        let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let accepted = Arc::clone(&sessions);
        let echoed = Arc::clone(&received);
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let accepted = Arc::clone(&accepted);
                let echoed = Arc::clone(&echoed);
                tokio::spawn(async move { serve(stream, accepted, echoed).await });
            }
        });
        FakeBridge {
            socket,
            sessions,
            received,
            task,
        }
    }

    /// How many device sessions dialled the bridge.
    pub fn session_count(&self) -> usize {
        self.sessions.lock().expect("sessions").len()
    }

    pub fn session_header(&self, index: usize, name: &str) -> Option<String> {
        header(self.sessions.lock().expect("sessions").get(index)?, name)
    }

    /// Every text frame a device session wrote, in arrival order.
    pub fn received(&self) -> Vec<String> {
        self.received.lock().expect("received").clone()
    }

    pub async fn stop(self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket);
    }
}

async fn serve(
    stream: UnixStream,
    sessions: Arc<Mutex<Vec<Headers>>>,
    received: Arc<Mutex<Vec<String>>>,
) {
    let Some((captured, socket)) = upgrade(stream).await else {
        return;
    };

    let session = {
        let headers = captured.lock().expect("headers");
        let session = header(&headers, "x-broski-role").as_deref() == Some("owner");
        if session {
            sessions.lock().expect("sessions").push(headers.clone());
        }
        session
    };

    let (mut sink, mut source) = socket.split();
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
        if session {
            received.lock().expect("received").push(text.clone());
        }
        if sink
            .send(Message::Text(format!("echo:{text}").into()))
            .await
            .is_err()
        {
            break;
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
            let headers = request
                .headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_owned(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            *seen.lock().expect("headers") = headers;
            Ok(response)
        },
    )
    .await
    .ok()?;
    Some((captured, socket))
}
