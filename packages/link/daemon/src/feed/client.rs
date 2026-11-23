use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use tracing::warn;

use crate::backoff::{self, Backoff};
use crate::device::{short, DeviceRecord};
use crate::push::{self, keys, live_activity::LiveActivityFeed, policy, seal};
use crate::relay::{PushRequest, RelayCommand};

use super::pending::{Pending, UNGROUPED};
use super::Deps;

const IDLE: Duration = Duration::from_secs(86_400);
/// A socket that stayed up this long resets the redial backoff; one a bridge accepts and closes at
/// once leaves it where it was.
const HEALTHY: Duration = Duration::from_secs(30);

type Socket = WebSocketStream<UnixStream>;
type Sink = SplitSink<Socket, Message>;

pub struct Request {
    pub message: Value,
    pub reply: oneshot::Sender<Option<Value>>,
}

pub fn spawn(
    deps: Arc<Deps>,
    inbox: mpsc::Receiver<Request>,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(run(deps, inbox, shutdown))
}

async fn run(
    deps: Arc<Deps>,
    mut inbox: mpsc::Receiver<Request>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut backoff = Backoff::new(deps.durations.feed_retry_min, deps.durations.feed_retry_max);
    let mut debounce = policy::Debounce::default();
    let mut live_activity = LiveActivityFeed::default();
    loop {
        if let Some(socket) = dial(&deps).await {
            let opened = Instant::now();
            deps.monitor.opened();
            session(
                socket,
                &deps,
                &mut inbox,
                &mut shutdown,
                &mut debounce,
                &mut live_activity,
            )
            .await;
            deps.monitor.closed();
            if backoff::healthy(opened, HEALTHY) {
                backoff.reset();
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(backoff.next()) => {}
            _ = shutdown.wait_for(|stopped| *stopped) => return,
        }
    }
}

async fn session(
    socket: Socket,
    deps: &Deps,
    inbox: &mut mpsc::Receiver<Request>,
    shutdown: &mut watch::Receiver<bool>,
    debounce: &mut policy::Debounce,
    live_activity: &mut LiveActivityFeed,
) {
    let (mut sink, mut source) = socket.split();
    let mut pending = Pending::new();
    let mut pong_by: Option<Instant> = None;
    let mut ticker = tokio::time::interval(deps.durations.feed_ping);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    ticker.tick().await;
    // Nothing left to ask the feed for is not a reason to drop the socket the bridge reports on.
    let mut askers = true;
    loop {
        let deadline = pong_by.unwrap_or_else(|| Instant::now() + IDLE);
        tokio::select! {
            incoming = source.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    handle(&text, deps, &mut pending, debounce, live_activity, &mut pong_by).await;
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            request = inbox.recv(), if askers => match request {
                Some(request) => {
                    if !forward(&mut sink, request, &mut pending).await {
                        break;
                    }
                }
                None => askers = false,
            },
            _ = ticker.tick() => {
                let ping = json!({"type": "link_feed_ping"}).to_string();
                if sink.send(Message::Text(ping.into())).await.is_err() {
                    break;
                }
                pong_by = Some(Instant::now() + deps.durations.feed_pong);
            }
            _ = tokio::time::sleep_until(deadline), if pong_by.is_some() => break,
            _ = crate::stop::stopped(shutdown) => break,
        }
    }
}

async fn forward(sink: &mut Sink, request: Request, pending: &mut Pending) -> bool {
    pending.sweep(Instant::now());
    let group = match request.message.get("request") {
        Some(group) if !group.is_null() => group.to_string(),
        _ => UNGROUPED.to_owned(),
    };
    if sink
        .send(Message::Text(request.message.to_string().into()))
        .await
        .is_err()
    {
        let _ = request.reply.send(None);
        return false;
    }
    pending.wait(group, request.reply);
    true
}

async fn handle(
    text: &str,
    deps: &Deps,
    pending: &mut Pending,
    debounce: &mut policy::Debounce,
    live_activity: &mut LiveActivityFeed,
    pong_by: &mut Option<Instant>,
) {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return;
    };
    match value.get("type").and_then(Value::as_str) {
        Some("link_feed_pong") => *pong_by = None,
        Some("link_busy") => {
            let busy = value.get("busy").and_then(Value::as_bool).unwrap_or(false);
            deps.busy.send_if_modified(|current| {
                if *current == busy {
                    false
                } else {
                    *current = busy;
                    true
                }
            });
        }
        Some("link_event") => alert(deps, &value, debounce).await,
        Some("link_resolved") => resolved(deps, &value).await,
        Some("link_runs") => live_activity.handle(deps, &value).await,
        Some("link_decision_result") => {
            let group = match value.get("request") {
                Some(group) if !group.is_null() => group.to_string(),
                _ => UNGROUPED.to_owned(),
            };
            if let Some(reply) = pending.take(&group) {
                let _ = reply.send(Some(value));
            }
        }
        _ => {}
    }
}

async fn alert(deps: &Deps, value: &Value, debounce: &mut policy::Debounce) {
    let Some(event) = push::event(value) else {
        return;
    };
    let targets = policy::targets(deps.store.devices().await, &event);
    let (key, window) = event.debounce(deps.durations.push_debounce);
    if targets.is_empty() || !debounce.allow(key, window, Instant::now()) {
        return;
    }
    let machine = deps.store.name().to_owned();
    let Some(plaintext) = seal::encode(&event.notification(&machine)) else {
        warn!(kind = event.kind.as_str(), "push payload does not fit");
        return;
    };
    let alert = Alert {
        kind: event.kind.relay_kind(),
        collapse: event.collapse(),
        priority: event.kind.priority(),
    };
    send_sealed(deps, targets, &plaintext, &alert);
}

/// A request that is over: the phones that can drop its notification quietly are told to.
async fn resolved(deps: &Deps, value: &Value) {
    let Some(resolved) = push::resolved(value) else {
        return;
    };
    let targets = policy::resolved_targets(deps.store.devices().await);
    if targets.is_empty() {
        return;
    }
    let machine = deps.store.name().to_owned();
    let Some(plaintext) = seal::encode(&resolved.notification(&machine)) else {
        return;
    };
    let alert = Alert {
        kind: "done",
        collapse: resolved.collapse(),
        priority: "high",
    };
    send_sealed(deps, targets, &plaintext, &alert);
}

/// How a push is labelled for the relay.
struct Alert {
    kind: &'static str,
    collapse: String,
    priority: &'static str,
}

fn send_sealed(deps: &Deps, targets: Vec<DeviceRecord>, plaintext: &[u8], alert: &Alert) {
    for device in targets {
        let Some(registration) = device.push.as_ref() else {
            continue;
        };
        let Some(secret) = keys::decode(&registration.key) else {
            warn!(device = short(&device.id), "push key is malformed");
            continue;
        };
        let notify = keys::notify(&secret);
        let Some(data) = seal::seal(&notify, deps.machine_id.as_bytes(), plaintext) else {
            continue;
        };
        let request = RelayCommand::Push(PushRequest {
            platform: registration.platform.clone(),
            token: registration.token.clone(),
            kind: alert.kind,
            data: crate::codec::b64url(&data),
            collapse: Some(alert.collapse.clone()),
            priority: alert.priority,
        });
        if deps.relay.try_send(request).is_err() {
            warn!(device = short(&device.id), "push not queued");
        }
    }
}

async fn dial(deps: &Deps) -> Option<Socket> {
    let headers = [("x-broski-role", "link-daemon".to_owned())];
    crate::dial::upgrade(
        &deps.socket,
        &deps.link_key,
        &headers,
        WebSocketConfig::default(),
        deps.durations.dial_timeout,
    )
    .await
}
