use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use broski_link_core::{Accepted, Link};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use zeroize::Zeroizing;

use crate::bridge::BridgeIn;
use crate::bridge_status::{BridgeMonitor, BridgeStatus};
use crate::conn::ConnSender;
use crate::control::MachineInfo;
use crate::device::DeviceRecord;
use crate::dialogs::MacDialog;
use crate::link_key::LinkKey;
use crate::offers::Offers;
use crate::registry::{Registry, SessionState};
use crate::relay::RelayHandle;
use crate::routes::{Adverts, Routes};
use crate::store::Store;
use crate::supervisor::Supervisor;

mod actor;
mod bridge;
mod close_codes;
mod flow;
mod peer;
mod screen;
mod status;
mod wire;

use bridge::BridgePump;
use screen::{ScreenIn, ScreenPump};
use status::SessionBridge;

pub struct SessionDeps {
    pub machine_id: String,
    pub machine_name: String,
    pub bridge_socket: PathBuf,
    pub link_key: Arc<LinkKey>,
    pub monitor: Arc<BridgeMonitor>,
    pub supervisor: Option<Supervisor>,
    pub store: Arc<Store>,
    pub routes: Routes,
    pub offers: Arc<Offers>,
    pub relay: RelayHandle,
    pub dialogs: watch::Receiver<Vec<MacDialog>>,
    pub screen_port: u16,
    pub shutdown: watch::Receiver<bool>,
    /// How long a session with no phone attached survives.
    pub idle_limit: Duration,
    /// The unix connect plus the websocket upgrade, for both bridge sockets.
    pub dial_timeout: Duration,
    /// How long a new connection may take to finish the Noise handshake.
    pub handshake_timeout: Duration,
}

pub enum SessionCommand {
    Accept {
        accepted: Box<Accepted>,
        sender: ConnSender,
        paired: Option<Zeroizing<String>>,
        pairing_revoke: Option<String>,
        reply: oneshot::Sender<()>,
    },
    Wire {
        conn: u64,
        bytes: Vec<u8>,
    },
    BridgeLetter {
        bytes: Vec<u8>,
        reply: oneshot::Sender<bool>,
    },
    Lost {
        conn: u64,
    },
}

pub fn spawn(
    device: DeviceRecord,
    state: Arc<SessionState>,
    commands: mpsc::Receiver<SessionCommand>,
    deps: Arc<SessionDeps>,
    registry: Arc<Registry>,
    token: u64,
) {
    let device_id = device.id.clone();
    tokio::spawn(async move {
        Actor::new(device, state, deps, commands).run().await;
        registry.stop_if_token(&device_id, token);
    });
}

/// What the actor is woken by.
enum Input {
    Command(SessionCommand),
    Bridge(BridgeIn),
    Screen(ScreenIn),
    BridgeStatus,
    Routes,
    Dialogs,
    Revoked,
    Timer,
    Shutdown,
}

/// One device's session: its link, its own bridge socket, and the flow control between them.
struct Actor {
    device: DeviceRecord,
    state: Arc<SessionState>,
    deps: Arc<SessionDeps>,
    commands: mpsc::Receiver<SessionCommand>,
    status_rx: watch::Receiver<BridgeStatus>,
    routes_rx: watch::Receiver<Adverts>,
    dialogs_rx: watch::Receiver<Vec<MacDialog>>,
    shutdown: watch::Receiver<bool>,
    link: Link,
    sender: Option<ConnSender>,
    paired: Option<Zeroizing<String>>,
    pairing_revoke: Option<String>,
    pending_revoke: Option<String>,
    bridge: BridgePump,
    screen: ScreenPump,
    last_bridge: Option<SessionBridge>,
    /// The one bridge message the link would not take yet, oldest first. Nothing else is read off
    /// the bridge socket while it waits, so the two stay in order.
    pending_device: Option<Vec<u8>>,
    /// The one screen message the link would not take yet, oldest first.
    pending_screen: Option<Vec<u8>>,
    /// Control messages the link would not take yet, in the order they were produced.
    pending_control: VecDeque<Vec<u8>>,
    /// Hysteresis state of the bridge read gate (see `flow::gate_open`).
    read_open: bool,
    /// Hysteresis state of the screen read gate (see `flow::screen_gate_open`).
    screen_read_open: bool,
    pending_out: Option<Vec<u8>>,
    detached_at: Option<Instant>,
    /// The close code the session is ending with; `None` while it is still running.
    close: Option<u16>,
}

fn machine_info<'a>(deps: &'a SessionDeps, adverts: &'a Adverts) -> MachineInfo<'a> {
    MachineInfo {
        id: &deps.machine_id,
        name: &deps.machine_name,
        os: std::env::consts::OS,
        relay: adverts.relay.as_deref(),
        lan: &adverts.lan,
    }
}
