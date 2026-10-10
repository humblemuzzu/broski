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
use axum::{Json, Router};
use broski_link_core::crypto::StaticIdentity;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tracing::debug;

use crate::codec;
use crate::conn::{self, ConnOut, Route};
use crate::responder::Responder;

pub const MAX_MESSAGE_BYTES: usize = 128 * 1024;

const MAX_CONNECTIONS: usize = 64;
const RATE_PER_SECOND: f64 = 20.0;
const RATE_BURST: f64 = 40.0;
const BUCKET_TTL: Duration = Duration::from_secs(60);

struct Bucket {
    tokens: f64,
    seen: Instant,
}

/// The LAN ingress: identity lookup plus the link upgrade on a plain TCP port.
pub struct Lan {
    responder: Arc<Responder>,
    public: String,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
    connections: Arc<AtomicUsize>,
}

impl Lan {
    pub fn new(responder: Arc<Responder>, identity: &StaticIdentity) -> Arc<Lan> {
        Arc::new(Lan {
            responder,
            public: codec::b64url(&identity.public().to_bytes()),
            buckets: Mutex::new(HashMap::new()),
            connections: Arc::new(AtomicUsize::new(0)),
        })
    }

    fn admit(self: &Arc<Self>, ip: IpAddr) -> Option<Admission> {
        if !self.allow(ip) {
            debug!("lan handshake rate limited");
            return None;
        }
        if self.connections.fetch_add(1, Ordering::Relaxed) >= MAX_CONNECTIONS {
            self.connections.fetch_sub(1, Ordering::Relaxed);
            debug!("lan connection limit reached");
            return None;
        }
        Some(Admission {
            connections: Arc::clone(&self.connections),
        })
    }

    fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut buckets = self
            .buckets
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        buckets.retain(|_, bucket| now.duration_since(bucket.seen) < BUCKET_TTL);
        let bucket = buckets.entry(ip).or_insert(Bucket {
            tokens: RATE_BURST,
            seen: now,
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
}

struct Admission {
    connections: Arc<AtomicUsize>,
}

impl Drop for Admission {
    fn drop(&mut self) {
        self.connections.fetch_sub(1, Ordering::Relaxed);
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
        listener,
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

async fn serve_socket(socket: WebSocket, lan: Arc<Lan>, admission: Admission) {
    let _admission = admission;
    let (mut sink, mut source) = socket.split();
    let parts = conn::channel(Route::Lan, None);
    let responder = Arc::clone(&lan.responder);
    let attached = tokio::spawn(async move { responder.run(parts.conn).await });

    tokio::spawn(async move {
        let mut outbound = parts.outbound;
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
    });

    let inbound = parts.inbound_tx;
    while let Some(message) = source.next().await {
        match message {
            Ok(Message::Binary(bytes)) => {
                if bytes.len() > MAX_MESSAGE_BYTES || inbound.send(bytes.to_vec()).await.is_err() {
                    break;
                }
            }
            Ok(Message::Text(_)) | Ok(Message::Close(_)) | Err(_) => break,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
        }
    }
    drop(inbound);
    let _ = attached.await;
}
