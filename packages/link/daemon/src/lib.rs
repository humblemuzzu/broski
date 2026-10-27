use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use broski_link_core::crypto::StaticIdentity;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;
use tracing::{debug, info};
use zeroize::Zeroizing;

mod backoff;
mod bridge;
mod bridge_status;
pub mod cli;
pub mod client;
mod clock;
mod codec;
mod config;
mod conn;
mod control;
mod control_socket;
mod device;
mod dial;
pub mod durations;
mod error;
mod feed;
mod fsx;
mod identity;
mod lan;
pub mod letters;
mod limits;
mod offers;
pub mod pairing;
mod power_policy;
pub mod push;
mod qr;
mod registry;
mod relay;
mod responder;
mod routes;
mod session;
mod stop;
mod store;
mod supervisor;

use crate::bridge_status::BridgeMonitor;
use crate::control_socket::Control;
use crate::durations::Durations;
use crate::lan::Lan;
use crate::offers::Offers;
use crate::registry::Registry;
use crate::relay::RelayCommand;
use crate::responder::Responder;
use crate::routes::Routes;
use crate::session::SessionDeps;
use crate::store::Store;

pub use config::{DEFAULT_BRIDGE_SOCKET, DEFAULT_LAN_PORT};
pub use error::{Error, Result};

const SHUTDOWN_DRAIN: Duration = Duration::from_secs(3);
const RELAY_COMMANDS: usize = 64;

pub struct RunOptions {
    pub home: PathBuf,
    pub relay: Option<String>,
    pub lan_port: u16,
    pub lan: bool,
    pub bridge_socket: PathBuf,
    pub bridge_cmd: Option<Vec<String>>,
    pub durations: Durations,
}

pub struct Handle {
    pub home: PathBuf,
    pub lan_port: Option<u16>,
    pub bridge_socket: PathBuf,
    stop: watch::Sender<bool>,
    tasks: JoinSet<()>,
}

impl Handle {
    pub fn control_path(&self) -> PathBuf {
        control_socket::path(&self.home)
    }

    pub async fn stop(mut self) {
        let _ = self.stop.send(true);
        let tasks = &mut self.tasks;
        let drained = timeout(SHUTDOWN_DRAIN, async {
            while tasks.join_next().await.is_some() {}
        })
        .await;
        if drained.is_err() {
            self.tasks.shutdown().await;
        }
    }
}

pub async fn run(options: RunOptions) -> Result<Handle> {
    fsx::ensure_dir(&options.home)?;
    let (listener, lan_port) = listen(&options).await?;
    info!(
        home = %options.home.display(),
        lan_port = lan_port.unwrap_or(0),
        "broski-link starting"
    );
    let (stop, shutdown) = watch::channel(false);
    let identity = Arc::new(identity::load(&options.home)?);
    let store = Store::open(&options.home).await?;
    let (busy, busy_signal) = watch::channel(false);
    let (commands, command_rx) = mpsc::channel(RELAY_COMMANDS);
    let seen = letters::replay::Seen::open(&options.home, options.durations.letter_ttl).await?;
    let parts = Parts {
        identity,
        store,
        offers: Offers::new(),
        monitor: BridgeMonitor::new(),
        registry: Registry::new(),
        relay: relay::handle(),
        routes: Routes::new(options.relay.clone()),
        busy,
        commands,
        seen,
    };
    parts.routes.refresh(lan_port.unwrap_or(0));
    let tasks = start_tasks(
        &options,
        listener,
        lan_port.unwrap_or(0),
        parts,
        command_rx,
        busy_signal,
        shutdown,
    )
    .await?;
    Ok(Handle {
        home: options.home,
        lan_port,
        bridge_socket: options.bridge_socket,
        stop,
        tasks,
    })
}

/// The shared pieces of the daemon, before any of them is moved into a task.
struct Parts {
    identity: Arc<StaticIdentity>,
    store: Arc<Store>,
    offers: Arc<Offers>,
    monitor: Arc<BridgeMonitor>,
    registry: Arc<Registry>,
    relay: relay::RelayHandle,
    routes: Routes,
    busy: watch::Sender<bool>,
    commands: mpsc::Sender<RelayCommand>,
    seen: Arc<letters::replay::Seen>,
}

async fn listen(options: &RunOptions) -> Result<(Option<TcpListener>, Option<u16>)> {
    if !options.lan {
        return Ok((None, None));
    }
    let (listener, port) = lan::bind(options.lan_port).await?;
    Ok((Some(listener), Some(port)))
}

#[allow(clippy::too_many_arguments)]
async fn start_tasks(
    options: &RunOptions,
    listener: Option<TcpListener>,
    lan_port: u16,
    parts: Parts,
    command_rx: mpsc::Receiver<RelayCommand>,
    busy: watch::Receiver<bool>,
    shutdown: watch::Receiver<bool>,
) -> Result<JoinSet<()>> {
    let mut tasks: JoinSet<()> = JoinSet::new();
    tasks.spawn(joined(routes::spawn(
        parts.routes.clone(),
        lan_port,
        shutdown.clone(),
    )));
    let (supervisor, supervisor_task) = supervise(options, &parts.monitor);
    if let Some(task) = supervisor_task {
        tasks.spawn(joined(task));
    }
    let responder = responder(options, &parts, supervisor, shutdown.clone());
    let control = control(options, &parts);
    control_socket::prepare(&control_socket::path(&options.home)).await?;
    tasks.spawn(joined(control_socket::spawn(control, shutdown.clone())?));

    let (feed_handle, feed_task) = feed::spawn(
        feed::Deps {
            socket: options.bridge_socket.clone(),
            machine_id: parts.identity.public().id(),
            store: parts.store.clone(),
            registry: parts.registry.clone(),
            relay: parts.commands.clone(),
            busy: parts.busy.clone(),
            monitor: parts.monitor.clone(),
            durations: options.durations,
        },
        shutdown.clone(),
    );
    tasks.spawn(joined(feed_task));

    let (letters_tx, letters_task) = letters::spawn(
        Arc::new(letter_deps(options, &parts, feed_handle)),
        shutdown.clone(),
    );
    tasks.spawn(joined(letters_task));

    tasks.spawn(joined(power_policy::spawn(
        power_policy::Deps {
            busy: parts.busy.subscribe(),
            relay: parts.commands.clone(),
            durations: options.durations,
        },
        shutdown.clone(),
    )));

    if let Some(listener) = listener {
        tasks.spawn(joined(serve_lan(
            listener,
            responder.clone(),
            &parts.identity,
            shutdown.clone(),
        )));
    }
    if let Some(task) = relay_task(
        options, &parts, responder, command_rx, busy, letters_tx, shutdown,
    ) {
        tasks.spawn(joined(task));
    }
    Ok(tasks)
}

fn letter_deps(options: &RunOptions, parts: &Parts, feed: feed::Handle) -> letters::Deps {
    letters::Deps {
        store: parts.store.clone(),
        registry: parts.registry.clone(),
        seen: parts.seen.clone(),
        feed,
        relay: parts.commands.clone(),
        bridge_socket: options.bridge_socket.clone(),
        machine_id: parts.identity.public().id(),
        durations: options.durations,
    }
}

fn session_deps(
    options: &RunOptions,
    parts: &Parts,
    supervisor: Option<supervisor::Supervisor>,
    shutdown: watch::Receiver<bool>,
) -> Arc<SessionDeps> {
    Arc::new(SessionDeps {
        machine_id: parts.identity.public().id(),
        machine_name: parts.store.name().to_owned(),
        bridge_socket: options.bridge_socket.clone(),
        monitor: parts.monitor.clone(),
        supervisor,
        store: parts.store.clone(),
        routes: parts.routes.clone(),
        offers: parts.offers.clone(),
        relay: parts.relay.clone(),
        shutdown,
        idle_limit: options.durations.session_idle,
        dial_timeout: options.durations.dial_timeout,
    })
}

fn responder(
    options: &RunOptions,
    parts: &Parts,
    supervisor: Option<supervisor::Supervisor>,
    shutdown: watch::Receiver<bool>,
) -> Arc<Responder> {
    Arc::new(Responder {
        identity: parts.identity.clone(),
        store: parts.store.clone(),
        offers: parts.offers.clone(),
        registry: parts.registry.clone(),
        relay: parts.relay.clone(),
        deps: session_deps(options, parts, supervisor, shutdown),
    })
}

fn supervise(
    options: &RunOptions,
    monitor: &Arc<BridgeMonitor>,
) -> (Option<supervisor::Supervisor>, Option<JoinHandle<()>>) {
    let command = options.bridge_cmd.clone().unwrap_or_default();
    let spawned = supervisor::spawn(command, options.bridge_socket.clone(), monitor.clone());
    match spawned {
        Some((supervisor, task)) => (Some(supervisor), Some(task)),
        None => (None, None),
    }
}

fn control(options: &RunOptions, parts: &Parts) -> Arc<Control> {
    Arc::new(Control {
        home: options.home.clone(),
        identity: parts.identity.clone(),
        store: parts.store.clone(),
        offers: parts.offers.clone(),
        routes: parts.routes.clone(),
        monitor: parts.monitor.clone(),
        registry: parts.registry.clone(),
        relay: parts.relay.clone(),
    })
}

fn relay_task(
    options: &RunOptions,
    parts: &Parts,
    responder: Arc<Responder>,
    commands: mpsc::Receiver<RelayCommand>,
    busy: watch::Receiver<bool>,
    letters: mpsc::Sender<letters::Incoming>,
    shutdown: watch::Receiver<bool>,
) -> Option<JoinHandle<()>> {
    let url = options.relay.clone()?;
    let config = relay::Config {
        url,
        machine_id: parts.identity.public().id(),
        secret: Zeroizing::new(parts.store.secret().to_vec()),
        public: codec::b64url(&parts.identity.public().to_bytes()),
        store: parts.store.clone(),
        responder,
        pairing: parts.offers.pairing(),
        busy,
        letters,
        commands,
        shutdown,
    };
    Some(relay::spawn(config, parts.relay.clone()))
}

fn serve_lan(
    listener: TcpListener,
    responder: Arc<Responder>,
    identity: &StaticIdentity,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    let lan = Lan::new(responder, identity);
    tokio::spawn(async move {
        if let Err(error) = lan::serve(listener, lan, shutdown).await {
            debug!(error = %error, "lan listener stopped");
        }
    })
}

async fn joined(task: JoinHandle<()>) {
    if let Err(error) = task.await {
        debug!(error = %error, "daemon task ended early");
    }
}

pub async fn run_command(args: cli::RunArgs) -> Result<()> {
    let handle = run(args.options()?).await?;
    info!(control = %handle.control_path().display(), "broski-link running");
    wait_for_signal().await;
    handle.stop().await;
    Ok(())
}

async fn wait_for_signal() {
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
        Ok(mut terminate) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
            }
        }
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}
