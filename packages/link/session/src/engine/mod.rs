//! One session's actor: it owns the sockets, the `Link`, the route race, the probe and the retry
//! policy, and it is the only thing that touches them. The handle reaches it through commands and
//! the shared outbound queue; it reaches the app through the shared event queue.

mod dial;
mod lifecycle;
mod migration;
mod pairing;
mod routes;
mod wire;

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use broski_link_core::crypto::PublicBundle;
use broski_link_core::proto::Config;
use broski_link_core::{Link, CONFIG};
use rustls::ClientConfig;
use tokio::sync::mpsc::{self, OwnedPermit};
use tokio::task::JoinSet;
use tokio::time::{sleep_until, Instant};

use crate::backoff::{Backoff, RouteRetry};
use crate::close::PeerClosePolicy;
use crate::control::PushPlatform;
use crate::endpoint::Target;
use crate::events::Shared;
use crate::identity::DeviceIdentity;
use crate::options::{SessionOptions, Timings};
use crate::pause::AppPause;
use crate::probe::LanProbePolicy;
use crate::race::RouteRace;
use crate::record::MachineRecord;
use crate::refusal::RelayRefusals;
use crate::status::StatusReporter;
use crate::tls;
use crate::transport::{DialError, Socket, SocketEvent, WsStream};

pub(crate) use pairing::Pairing;

/// Frames from every socket of the session, waiting for the engine.
const SOCKET_EVENTS: usize = 64;
/// Nothing is due: the loop still wakes this often, which costs nothing and bounds a missed wake.
const IDLE: Duration = Duration::from_secs(3600);

pub(crate) enum Command {
    Pause,
    Resume,
    NetworkChanged,
    LanDiscovered(Vec<String>),
    Push(Option<PushIntent>),
    LiveActivity(Option<LiveActivityIntent>),
    Close,
}

/// What the machine should hold for this phone's active iOS Live Activity; sent again after every
/// connect until cleared.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum LiveActivityIntent {
    Register { token: String },
    Unregister,
}

/// What the machine should hold for this phone's pushes; sent again after every connect, so a
/// machine that restarted and re-read its state is told again.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PushIntent {
    Register {
        platform: PushPlatform,
        token: String,
    },
    Unregister,
}

pub(crate) struct Parts {
    pub(crate) shared: Arc<Shared>,
    pub(crate) commands: mpsc::UnboundedReceiver<Command>,
    pub(crate) identity: DeviceIdentity,
    pub(crate) server: PublicBundle,
    pub(crate) record: MachineRecord,
    pub(crate) pairing: Option<Pairing>,
    pub(crate) options: SessionOptions,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Purpose {
    Lan(usize),
    Relay,
    Probe,
}

struct Dialed {
    generation: u64,
    purpose: Purpose,
    target: Target,
    result: Result<WsStream, DialError>,
}

/// One attempt to open a route: every LAN candidate and the relay at once.
struct Race {
    generation: u64,
    race: RouteRace,
    lan: Vec<Option<Socket>>,
    relay: Option<Socket>,
    pending: usize,
    grace_at: Option<Instant>,
    /// The relay answered the upgrade 401.
    relay_refused: bool,
}

/// LAN candidates dialled one at a time while the relay carries the link.
struct Probe {
    policy: LanProbePolicy,
    hosts: Vec<Target>,
    running: Option<(u64, VecDeque<Target>)>,
}

/// A LAN socket handshaking while the relay socket keeps carrying the session.
struct Migration {
    socket: Socket,
    reply_by: Instant,
}

/// The deadlines of one handshake attempt; `sent` says msg1 went out on the current socket.
#[derive(Default)]
struct Handshake {
    sent: bool,
    reply_by: Option<Instant>,
    presence_by: Option<Instant>,
}

pub(crate) struct Engine {
    shared: Arc<Shared>,
    commands: mpsc::UnboundedReceiver<Command>,
    socket_tx: mpsc::Sender<SocketEvent>,
    socket_rx: mpsc::Receiver<SocketEvent>,
    dials: JoinSet<Dialed>,
    tls: Arc<ClientConfig>,
    clock: Instant,
    link: Link,
    identity: DeviceIdentity,
    server: PublicBundle,
    record: MachineRecord,
    pairing: Option<Pairing>,
    options: SessionOptions,
    has_session: bool,
    current: Option<Socket>,
    migration: Option<Migration>,
    race: Option<Race>,
    probe: Probe,
    handshake: Handshake,
    retry: RouteRetry,
    refusals: RelayRefusals,
    retry_at: Option<(Instant, Option<crate::status::Route>)>,
    pause: AppPause,
    /// The app paused while the machine still lacked some of what was sent: the pause happens
    /// once it has all of it, or at this instant.
    pause_by: Option<Instant>,
    close: PeerClosePolicy,
    reporter: StatusReporter,
    pending_wire: Option<Vec<u8>>,
    push: Option<PushIntent>,
    live_activity: Option<LiveActivityIntent>,
    lan_seen: Vec<(String, Instant)>,
    next_id: u64,
    reading_paused: bool,
    finished: bool,
}

impl Engine {
    pub(crate) fn new(parts: Parts) -> Engine {
        let now = Instant::now();
        let timings = parts.options.timings;
        let (socket_tx, socket_rx) = mpsc::channel(SOCKET_EVENTS);
        Engine {
            shared: parts.shared,
            commands: parts.commands,
            socket_tx,
            socket_rx,
            dials: JoinSet::new(),
            tls: tls::client_config(),
            clock: now,
            link: Link::client(link_config(&timings)),
            identity: parts.identity,
            server: parts.server,
            record: parts.record,
            pairing: parts.pairing,
            has_session: false,
            current: None,
            migration: None,
            race: None,
            probe: Probe {
                policy: LanProbePolicy::new(timings.probe_interval, now),
                hosts: Vec::new(),
                running: None,
            },
            handshake: Handshake::default(),
            retry: RouteRetry::new(Backoff::new(timings.backoff_min, timings.backoff_max)),
            refusals: RelayRefusals::new(timings.relay_refusal_window),
            retry_at: None,
            pause: AppPause::new(timings.stale_socket),
            pause_by: None,
            close: PeerClosePolicy::default(),
            reporter: StatusReporter::new(),
            pending_wire: None,
            push: None,
            live_activity: None,
            lan_seen: Vec::new(),
            next_id: 0,
            reading_paused: false,
            finished: false,
            options: parts.options,
        }
    }

    pub(crate) async fn run(mut self) {
        self.connect(None);
        while !self.finished {
            self.flush();
            self.settle_pause();
            self.gate_reading();
            self.step().await;
        }
        self.shared.close_events();
    }

    async fn step(&mut self) {
        let deadline = self.deadline();
        let writer = self.pending_writer();
        let (writing, reading) = (writer.is_some(), !self.reading_paused);
        let dialing = !self.dials.is_empty();
        tokio::select! {
            command = self.commands.recv() => self.on_command(command).await,
            () = self.shared.outbound_ready.notified() => {}
            Some(event) = self.socket_rx.recv(), if reading => self.on_socket(event),
            Some(joined) = self.dials.join_next(), if dialing => {
                if let Ok(dialed) = joined {
                    self.on_dialed(dialed);
                }
            }
            Ok(permit) = reserve(writer), if writing => self.on_writable(permit),
            () = self.shared.drained(), if !reading => {}
            () = sleep_until(deadline) => self.on_timer(),
        }
    }

    /// The app reading too slowly stops the socket reads until it is under half its backlog.
    fn gate_reading(&mut self) {
        if self.reading_paused {
            self.reading_paused = !self.shared.caught_up();
        } else {
            self.reading_paused = self.shared.backlogged();
        }
    }

    fn deadline(&self) -> Instant {
        let link = self
            .link
            .poll_timeout()
            .map(|ms| self.clock + Duration::from_millis(ms));
        let probe = (self.probe_armed())
            .then(|| self.probe.policy.due())
            .flatten();
        [
            link,
            self.handshake.reply_by,
            self.handshake.presence_by,
            self.retry_at.map(|(at, _)| at),
            self.race.as_ref().and_then(|race| race.grace_at),
            self.migration.as_ref().map(|migration| migration.reply_by),
            probe,
            self.pause_by,
        ]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or_else(|| Instant::now() + IDLE)
    }

    fn on_timer(&mut self) {
        let now = Instant::now();
        if self.deadline_passed(self.link.poll_timeout(), now) {
            self.link.handle_timeout(self.now_ms());
            self.drain_link();
        }
        if take_due(&mut self.handshake.reply_by, now)
            || take_due(&mut self.handshake.presence_by, now)
        {
            self.on_failure();
        }
        if self
            .migration
            .as_ref()
            .is_some_and(|migration| migration.reply_by <= now)
        {
            self.abandon_migration();
        }
        if self.retry_at.is_some_and(|(at, _)| at <= now) {
            let only = self.retry_at.take().and_then(|(_, only)| only);
            self.connect(only);
        }
        if let Some(race) = self
            .race
            .as_mut()
            .filter(|race| race.grace_at.is_some_and(|at| at <= now))
        {
            race.grace_at = None;
            race.race.grace_elapsed();
            self.settle();
        }
        if self.probe_armed() && self.probe.policy.due().is_some_and(|due| due <= now) {
            self.start_probe();
        }
    }

    fn deadline_passed(&self, ms: Option<u64>, now: Instant) -> bool {
        ms.is_some_and(|ms| self.clock + Duration::from_millis(ms) <= now)
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn next_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn pending_writer(&self) -> Option<mpsc::Sender<Vec<u8>>> {
        self.pending_wire.as_ref()?;
        self.current.as_ref()?.out().cloned()
    }

    fn on_writable(&mut self, permit: OwnedPermit<Vec<u8>>) {
        if let Some(frame) = self.pending_wire.take() {
            permit.send(frame);
        }
    }
}

/// The machine's link config with the phone's own liveness windows.
fn link_config(timings: &Timings) -> Config {
    Config {
        ping_idle_ms: millis(timings.ping_idle),
        dead_after_ms: millis(timings.dead_after),
        ..CONFIG
    }
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

fn take_due(slot: &mut Option<Instant>, now: Instant) -> bool {
    if slot.is_some_and(|at| at <= now) {
        *slot = None;
        return true;
    }
    false
}

async fn reserve(
    writer: Option<mpsc::Sender<Vec<u8>>>,
) -> Result<OwnedPermit<Vec<u8>>, mpsc::error::SendError<()>> {
    match writer {
        Some(writer) => writer.reserve_owned().await,
        None => std::future::pending().await,
    }
}
