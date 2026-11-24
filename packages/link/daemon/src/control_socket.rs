use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use broski_link_core::crypto::StaticIdentity;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tracing::{debug, info};

use crate::bridge_status::BridgeMonitor;
use crate::clock;
use crate::device::{short, DeviceRecord};
use crate::error::{Error, Result};
use crate::offers::Offers;
use crate::registry::Registry;
use crate::relay::RelayHandle;
use crate::routes::Routes;
use crate::store::Store;

pub const FILE: &str = "control.sock";

const SOCKET_MODE: u32 = 0o600;
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REQUEST_BYTES: usize = 8192;
const MIN_DEVICE_PREFIX: usize = 8;

pub struct Control {
    pub home: PathBuf,
    pub identity: Arc<StaticIdentity>,
    pub store: Arc<Store>,
    pub offers: Arc<Offers>,
    pub routes: Routes,
    pub monitor: Arc<BridgeMonitor>,
    pub registry: Arc<Registry>,
    pub relay: RelayHandle,
    pub screen_enabled: watch::Sender<bool>,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
enum Request {
    Pair,
    Status,
    Devices,
    Revoke { device: String },
}

pub fn path(home: &Path) -> PathBuf {
    home.join(FILE)
}

/// Refuses to start when something still answers on the path, like the bridge's own socket.
pub async fn prepare(socket: &Path) -> Result<()> {
    if !socket.exists() {
        return Ok(());
    }
    if timeout(PROBE_TIMEOUT, UnixStream::connect(socket))
        .await
        .is_ok_and(|result| result.is_ok())
    {
        return Err(Error::message(format!(
            "another broski-link daemon is already serving {}",
            socket.display()
        )));
    }
    std::fs::remove_file(socket)?;
    Ok(())
}

pub fn spawn(control: Arc<Control>, shutdown: watch::Receiver<bool>) -> Result<JoinHandle<()>> {
    let socket = path(&control.home);
    let listener = UnixListener::bind(&socket)?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(SOCKET_MODE))?;
    info!(socket = %socket.display(), "control socket ready");
    Ok(tokio::spawn(run(listener, socket, control, shutdown)))
}

async fn run(
    listener: UnixListener,
    socket: PathBuf,
    control: Arc<Control>,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    let control = Arc::clone(&control);
                    tokio::spawn(serve(stream, control));
                }
                Err(error) => debug!(error = %error, "control socket accept failed"),
            },
            _ = shutdown.wait_for(|stopped| *stopped) => break,
        }
    }
    let _ = std::fs::remove_file(&socket);
}

async fn serve(stream: UnixStream, control: Arc<Control>) {
    let (reader, mut writer) = stream.into_split();
    let reader = BufReader::new(reader).take((MAX_REQUEST_BYTES + 1) as u64);
    let mut lines = reader.lines();
    let Ok(Ok(Some(line))) = timeout(REQUEST_TIMEOUT, lines.next_line()).await else {
        return;
    };
    if line.len() > MAX_REQUEST_BYTES {
        return;
    }
    let reply = match serde_json::from_str::<Request>(&line) {
        Ok(request) => handle(&control, request).await,
        Err(error) => json!({"error": format!("bad request: {error}")}),
    };
    let mut text = reply.to_string();
    text.push('\n');
    let _ = writer.write_all(text.as_bytes()).await;
}

async fn handle(control: &Arc<Control>, request: Request) -> Value {
    let outcome = match request {
        Request::Pair => pair(control).await,
        Request::Status => Ok(status(control)),
        Request::Devices => devices(control).await,
        Request::Revoke { device } => revoke(control, &device).await,
    };
    outcome.unwrap_or_else(|error| json!({"error": error.to_string()}))
}

async fn pair(control: &Arc<Control>) -> Result<Value> {
    let adverts = control.routes.current();
    let (uri, expires_at) = control
        .offers
        .open(
            &control.identity,
            control.store.name(),
            adverts.relay,
            adverts.lan,
            clock::unix_secs(),
        )
        .await?;
    let code =
        broski_link_core::crypto::verification_code(&control.identity.public().fingerprint());
    Ok(json!({"uri": uri, "expires_at": expires_at, "code": code}))
}

fn status(control: &Arc<Control>) -> Value {
    let adverts = control.routes.current();
    let bridge = control.monitor.status();
    let sessions: Vec<Value> = control
        .registry
        .live()
        .iter()
        .map(|session| {
            json!({
                "device": short(&session.device),
                "route": session.route,
                "connected": session.connected,
            })
        })
        .collect();
    json!({
        "machine": {"id": control.identity.public().id(), "name": control.store.name()},
        "relay_connected": control.relay.connected(),
        "lan": adverts.lan,
        "bridge": {"state": bridge.state, "detail": bridge.detail},
        "sessions": sessions,
    })
}

async fn devices(control: &Arc<Control>) -> Result<Value> {
    let devices: Vec<Value> = control
        .store
        .devices()
        .await
        .iter()
        .map(|device| {
            let summary = device.summary();
            json!({
                "id": summary.id,
                "name": summary.name,
                "platform": summary.platform,
                "role": summary.role,
                "paired_at": summary.paired_at,
            })
        })
        .collect();
    Ok(Value::Array(devices))
}

async fn revoke(control: &Arc<Control>, prefix: &str) -> Result<Value> {
    if prefix.len() < MIN_DEVICE_PREFIX {
        return Err(Error::message(format!(
            "a device prefix must be at least {MIN_DEVICE_PREFIX} characters"
        )));
    }
    let devices: Vec<DeviceRecord> = control
        .store
        .devices()
        .await
        .into_iter()
        .filter(|device| device.id.starts_with(prefix))
        .collect();
    let device = match devices.as_slice() {
        [] => return Err(Error::message(format!("no device starts with {prefix}"))),
        [device] => device,
        _ => {
            return Err(Error::message(format!(
                "{prefix} matches {} devices; use a longer prefix",
                devices.len()
            )))
        }
    };
    control.store.remove_device(&device.id).await?;
    control.registry.stop(&device.id);
    control.relay.refresh();
    let any = control.store.any_remote_screen().await;
    control.screen_enabled.send_if_modified(|current| {
        if *current == any {
            false
        } else {
            *current = any;
            true
        }
    });
    info!(device = short(&device.id), "device revoked");
    Ok(json!({"ok": true, "device": device.id}))
}
