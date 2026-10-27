use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::header;
use super::Headers;

type Socket = WebSocketStream<UnixStream>;
type Sink = SplitSink<Socket, Message>;
type Source = SplitStream<Socket>;

/// One message this fake wrote, and how long the write took: a write that stalls is how a test
/// sees backpressure reach the source that produced it.
#[derive(Clone)]
pub struct Sent {
    pub len: usize,
    pub took: Duration,
}

/// A bridge fake a test can drive: it streams a scripted volume of oversized bridge messages at a
/// session, records how long each write took, records what the daemon wrote back, and can drop the
/// session socket or stop accepting new ones.
pub struct ScriptedBridge {
    pub socket: PathBuf,
    inner: Arc<Inner>,
    task: JoinHandle<()>,
}

struct Inner {
    dials: AtomicUsize,
    sent: Mutex<Vec<Sent>>,
    written: AtomicUsize,
    received: Mutex<Vec<String>>,
    plan: Mutex<Vec<usize>>,
    kill: Mutex<Option<oneshot::Sender<()>>>,
    reading: AtomicBool,
    writing_since: Mutex<Option<Instant>>,
    closed_by_daemon: AtomicBool,
}

impl Inner {
    fn new() -> Inner {
        Inner {
            dials: AtomicUsize::new(0),
            sent: Mutex::new(Vec::new()),
            written: AtomicUsize::new(0),
            received: Mutex::new(Vec::new()),
            plan: Mutex::new(Vec::new()),
            kill: Mutex::new(None),
            reading: AtomicBool::new(true),
            writing_since: Mutex::new(None),
            closed_by_daemon: AtomicBool::new(false),
        }
    }

    fn received(&self) -> std::sync::MutexGuard<'_, Vec<String>> {
        self.received
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

impl ScriptedBridge {
    pub async fn start(socket: PathBuf) -> ScriptedBridge {
        let listener = UnixListener::bind(&socket).expect("bind the scripted bridge");
        let inner = Arc::new(Inner::new());
        let accepted = Arc::clone(&inner);
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let inner = Arc::clone(&accepted);
                tokio::spawn(async move { serve(stream, inner).await });
            }
        });
        ScriptedBridge {
            socket,
            inner,
            task,
        }
    }

    /// The message sizes the next session socket writes, in order.
    pub fn stream(&self, sizes: &[usize]) {
        *self
            .inner
            .plan
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = sizes.to_vec();
    }

    /// Stops draining what the daemon writes, so its queue for the bridge fills up.
    pub fn stop_reading(&self) {
        self.inner.reading.store(false, Ordering::Relaxed);
    }

    /// Drops the session socket. The next one reads again, so a redial behaves normally.
    pub fn kill_session(&self) {
        self.inner.reading.store(true, Ordering::Relaxed);
        let kill = self
            .inner
            .kill
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        if let Some(kill) = kill {
            let _ = kill.send(());
        }
    }

    /// Stops listening: connections that already opened stay, new dials are refused.
    pub fn refuse_sessions(&self) {
        self.task.abort();
    }

    pub fn dials(&self) -> usize {
        self.inner.dials.load(Ordering::Relaxed)
    }

    /// Every message written to a session socket, in order.
    pub fn sent(&self) -> Vec<Sent> {
        self.inner
            .sent
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn written(&self) -> usize {
        self.inner.written.load(Ordering::Relaxed)
    }

    /// How long the write that is in flight right now has been running: a write that never returns
    /// while no ack comes back is backpressure reaching the bridge.
    pub fn stalled_for(&self) -> Option<Duration> {
        self.inner
            .writing_since
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .map(|at| at.elapsed())
    }

    /// Every frame the daemon wrote on a session socket, in arrival order.
    pub fn received(&self) -> Vec<String> {
        self.inner.received().clone()
    }

    /// True when this fake saw a write fail because the daemon dropped the socket.
    pub fn closed_by_daemon(&self) -> bool {
        self.inner.closed_by_daemon.load(Ordering::Relaxed)
    }

    pub fn stop(self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket);
    }
}

/// The bytes of message `index`: a text header a phone can check, then incompressible noise, so
/// the link's window and the deflate attempt both see the real size.
pub fn payload(index: usize, size: usize) -> Vec<u8> {
    let mut bytes = format!("m{index:04}|").into_bytes();
    let mut state = 0x9e37_79b9_7f4a_7c15u64 ^ index as u64;
    while bytes.len() < size {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        bytes.extend_from_slice(&state.to_le_bytes());
    }
    bytes.truncate(size);
    bytes
}

async fn serve(stream: UnixStream, inner: Arc<Inner>) {
    let Some((headers, socket)) = upgrade(stream).await else {
        return;
    };
    if header(&headers, "x-broski-role").as_deref() != Some("owner") {
        feed(socket).await;
        return;
    }
    inner.dials.fetch_add(1, Ordering::Relaxed);
    let plan = std::mem::take(&mut *inner.plan.lock().unwrap_or_else(|error| error.into_inner()));
    let (kill, killed) = oneshot::channel();
    *inner.kill.lock().unwrap_or_else(|error| error.into_inner()) = Some(kill);
    let (mut sink, mut source) = socket.split();
    tokio::select! {
        _ = write(&mut sink, &inner, plan) => {}
        _ = read(&mut source, &inner) => {}
        _ = killed => {
            let _ = sink.send(Message::Close(None)).await;
        }
    }
}

async fn write(sink: &mut Sink, inner: &Inner, plan: Vec<usize>) {
    for (index, size) in plan.into_iter().enumerate() {
        *inner
            .writing_since
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(Instant::now());
        let outcome = sink
            .send(Message::Binary(payload(index, size).into()))
            .await;
        let took = inner
            .writing_since
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
            .map_or_default(|at| at.elapsed());
        inner
            .sent
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(Sent { len: size, took });
        if outcome.is_err() {
            inner.closed_by_daemon.store(true, Ordering::Relaxed);
            return;
        }
        inner.written.fetch_add(size, Ordering::Relaxed);
    }
    std::future::pending::<()>().await;
}

async fn read(source: &mut Source, inner: &Inner) {
    while inner.reading.load(Ordering::Relaxed) {
        let message = match source.next().await {
            Some(Ok(message)) => message,
            Some(Err(_)) | None => return,
        };
        match message {
            Message::Text(text) => inner.received().push(text.as_str().to_owned()),
            Message::Binary(bytes) => inner
                .received()
                .push(String::from_utf8_lossy(&bytes).into_owned()),
            Message::Close(_) => return,
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
    std::future::pending::<()>().await;
}

/// The daemon's own feed socket shares this listener; it only has to stay open and answer pings.
async fn feed(socket: Socket) {
    let (mut sink, mut source) = socket.split();
    while let Some(Ok(message)) = source.next().await {
        let ping = match message {
            Message::Text(text) => text.contains("link_feed_ping"),
            _ => false,
        };
        if ping {
            let pong = serde_json::json!({"type": "link_feed_pong"}).to_string();
            if sink.send(Message::Text(pong.into())).await.is_err() {
                return;
            }
        }
    }
}

#[allow(
    clippy::result_large_err,
    reason = "the upgrade callback signature is fixed by tungstenite"
)]
async fn upgrade(stream: UnixStream) -> Option<(Headers, Socket)> {
    let captured: Arc<Mutex<Headers>> = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&captured);
    let socket = tokio_tungstenite::accept_hdr_async(
        stream,
        move |request: &Request, response: Response| {
            *seen.lock().unwrap_or_else(|error| error.into_inner()) = request
                .headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_owned(),
                        value.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            Ok(response)
        },
    )
    .await
    .ok()?;
    let headers = captured
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    Some((headers, socket))
}
