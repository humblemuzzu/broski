use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::serve::ListenerExt;
use axum::{Json, Router};
use broski_link_core::crypto::StaticIdentity;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::time::timeout;
use tracing::debug;

use crate::codec;
use crate::conn::{self, ConnOut, Route};
use crate::responder::Responder;
use crate::segments;

pub const MAX_MESSAGE_BYTES: usize = 128 * 1024;

/// Sockets the whole daemon serves at once, and how many of them one address may hold: a single
/// host can never take every slot, so the owner can still reach their own machine.
const MAX_CONNECTIONS: usize = 64;
const MAX_CONNECTIONS_PER_IP: usize = 8;
const RATE_PER_SECOND: f64 = 20.0;
const RATE_BURST: f64 = 40.0;
const BUCKET_TTL: Duration = Duration::from_secs(60);
/// How long the session is given to notice a connection ended once its socket is gone, how long
/// the writer gets to hand over what the session queued before it ended, and how long the socket
/// is then read so the phone's last frames are not still unread when it closes.
const LOST_REPORT: Duration = Duration::from_secs(2);
const WRITER_DRAIN: Duration = Duration::from_secs(2);
const LINGER: Duration = Duration::from_secs(1);

struct Bucket {
    tokens: f64,
    seen: Instant,
    live: usize,
}

/// The LAN ingress: identity lookup plus the link upgrade on a plain TCP port.
pub struct Lan {
    responder: Arc<Responder>,
    public: String,
    buckets: Arc<Mutex<HashMap<IpAddr, Bucket>>>,
    connections: Arc<AtomicUsize>,
}

impl Lan {
    pub fn new(responder: Arc<Responder>, identity: &StaticIdentity) -> Arc<Lan> {
        Arc::new(Lan {
            responder,
            public: codec::b64url(&identity.public().to_bytes()),
            buckets: Arc::new(Mutex::new(HashMap::new())),
            connections: Arc::new(AtomicUsize::new(0)),
        })
    }

    fn admit(self: &Arc<Self>, ip: IpAddr) -> Option<Admission> {
        if !self.allow(ip) {
            debug!("lan handshake rate limited");
            return None;
        }
        if !self.hold(ip) {
            debug!("lan connection limit reached for that address");
            return None;
        }
        if self.connections.fetch_add(1, Ordering::Relaxed) >= MAX_CONNECTIONS {
            self.connections.fetch_sub(1, Ordering::Relaxed);
            self.release(ip);
            debug!("lan connection limit reached");
            return None;
        }
        Some(Admission {
            ip,
            buckets: Arc::clone(&self.buckets),
            connections: Arc::clone(&self.connections),
        })
    }

    /// One handshake token for `ip`, and room for one more socket from it.
    fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut buckets = self.buckets();
        buckets.retain(|_, bucket| bucket.live > 0 || now.duration_since(bucket.seen) < BUCKET_TTL);
        let bucket = buckets.entry(ip).or_insert(Bucket {
            tokens: RATE_BURST,
            seen: now,
            live: 0,
        });
        bucket.tokens = (bucket.tokens
            + now.duration_since(bucket.seen).as_secs_f64() * RATE_PER_SECOND)
            .min(RATE_BURST);
        bucket.seen = now;
        if bucket.tokens < 1.0 {
            return false;
        }
        bucket.tokens -= 1.0;
        true
    }

    fn hold(&self, ip: IpAddr) -> bool {
        let mut buckets = self.buckets();
        let Some(bucket) = buckets.get_mut(&ip) else {
            return false;
        };
        if bucket.live >= MAX_CONNECTIONS_PER_IP {
            return false;
        }
        bucket.live += 1;
        true
    }

    fn release(&self, ip: IpAddr) {
        let mut buckets = self.buckets();
        if let Some(bucket) = buckets.get_mut(&ip) {
            bucket.live = bucket.live.saturating_sub(1);
        }
    }

    fn buckets(&self) -> std::sync::MutexGuard<'_, HashMap<IpAddr, Bucket>> {
        self.buckets
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

struct Admission {
    ip: IpAddr,
    buckets: Arc<Mutex<HashMap<IpAddr, Bucket>>>,
    connections: Arc<AtomicUsize>,
}

impl Drop for Admission {
    fn drop(&mut self) {
        self.connections.fetch_sub(1, Ordering::Relaxed);
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(bucket) = buckets.get_mut(&self.ip) {
            bucket.live = bucket.live.saturating_sub(1);
        }
    }
}

#[derive(Serialize)]
struct Identity {
    #[serde(rename = "pub")]
    public: String,
}

pub async fn bind(port: u16) -> std::io::Result<(TcpListener, u16)> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    let bound = listener.local_addr()?.port();
    Ok((listener, bound))
}

pub async fn serve(
    listener: TcpListener,
    lan: Arc<Lan>,
    mut shutdown: watch::Receiver<bool>,
) -> std::io::Result<()> {
    let router = Router::new()
        .route("/v1/identity", get(identity))
        .route("/v1/link", get(link))
        .with_state(lan);
    axum::serve(
        listener.tap_io(segments::clamp),
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        let _ = shutdown.wait_for(|stopped| *stopped).await;
    })
    .await
}

async fn identity(State(lan): State<Arc<Lan>>) -> Json<Identity> {
    Json(Identity {
        public: lan.public.clone(),
    })
}

async fn link(
    State(lan): State<Arc<Lan>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    upgrade: WebSocketUpgrade,
) -> Response {
    let Some(admission) = lan.admit(peer.ip()) else {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response();
    };
    upgrade
        .max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| serve_socket(socket, lan, admission))
        .into_response()
}

enum Ended {
    /// The responder returned: the session is over, or the socket asked for it.
    Session,
    /// The socket is gone before the session noticed.
    Socket,
}

async fn serve_socket(socket: WebSocket, lan: Arc<Lan>, admission: Admission) {
    let _admission = admission;
    let (sink, source) = socket.split();
    let parts = conn::channel(Route::Lan, None);
    let writer = tokio::spawn(write(sink, parts.outbound));
    let responder = Arc::clone(&lan.responder);

    // The responder owns the connection for as long as it lasts, so the socket ends when it does:
    // a peer that never finishes the handshake gives its slot back when the handshake window is
    // over instead of holding it until it decides to send something.
    let mut attached = Box::pin(responder.run(parts.conn));
    let mut reader = Box::pin(read(source, parts.inbound_tx));
    // The session's own end is checked first: when both are ready the socket is already being
    // closed for the session, and what it queued still has to go out.
    let ended = tokio::select! {
        biased;
        () = &mut attached => Ended::Session,
        () = &mut reader => Ended::Socket,
    };
    match ended {
        Ended::Session => {
            // What the session handed over before it ended still goes out, the close frame
            // included; then the socket is read a little longer, because a socket closed with the
            // phone's own bytes still unread makes the kernel reset the connection and the phone
            // loses whatever it had not read yet.
            drain(writer).await;
            let _ = timeout(LINGER, &mut reader).await;
        }
        Ended::Socket => {
            drop(reader);
            let _ = timeout(LOST_REPORT, attached).await;
            writer.abort();
        }
    }
}

async fn drain(mut writer: tokio::task::JoinHandle<()>) {
    if timeout(WRITER_DRAIN, &mut writer).await.is_err() {
        writer.abort();
    }
}

async fn write(
    mut sink: futures_util::stream::SplitSink<WebSocket, Message>,
    mut outbound: tokio::sync::mpsc::Receiver<ConnOut>,
) {
    while let Some(out) = outbound.recv().await {
        match out {
            ConnOut::Wire(bytes) => {
                if sink.send(Message::Binary(bytes.into())).await.is_err() {
                    break;
                }
            }
            // only a relay channel has a machine socket to carry this
            ConnOut::Revoke(_) => {}
            ConnOut::Close => break,
        }
    }
    let _ = sink.close().await;
}

async fn read(
    mut source: futures_util::stream::SplitStream<WebSocket>,
    inbound: tokio::sync::mpsc::Sender<Vec<u8>>,
) {
    while let Some(message) = source.next().await {
        match message {
            Ok(Message::Binary(bytes)) => {
                if bytes.len() > MAX_MESSAGE_BYTES || inbound.send(bytes.to_vec()).await.is_err() {
                    return;
                }
            }
            Ok(Message::Text(_)) | Ok(Message::Close(_)) | Err(_) => return,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
        }
    }
}
