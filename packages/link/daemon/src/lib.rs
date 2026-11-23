use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;
use tracing::{debug, info};

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
mod discovery;
pub mod durations;
mod error;
mod feed;
mod fsx;
mod identity;
mod lan;
pub mod letters;
mod limits;
mod link_key;
mod offers;
pub mod pairing;
mod power_policy;
pub mod push;
mod qr;
mod registry;
mod relay;
mod responder;
mod routes;
mod segments;
mod session;
mod stop;
mod store;
mod supervisor;
mod tasks;

use crate::durations::Durations;
use crate::relay::RelayCommand;
use crate::store::Store;
use crate::tasks::{Parts, Tasks};

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
    /// Announce the machine over mDNS. Off for daemons that must not show up on a real network.
    pub advertise: bool,
    /// Advertise the machine's interface addresses as LAN routes. Off for daemons that must not
    /// hand a phone the addresses of the network they happen to run on.
    pub scan_interfaces: bool,
    pub durations: Durations,
}

pub struct Handle {
    pub home: PathBuf,
    pub lan_port: Option<u16>,
    pub bridge_socket: PathBuf,
    stop: watch::Sender<bool>,
    tasks: JoinSet<()>,
    advertisement: Option<Arc<discovery::Advertisement>>,
}

impl Handle {
    pub fn control_path(&self) -> PathBuf {
        control_socket::path(&self.home)
    }

    pub async fn stop(mut self) {
        if let Some(advertisement) = self.advertisement.take() {
            if let Err(error) = tokio::task::spawn_blocking(move || advertisement.withdraw()).await
            {
                debug!(error = %error, "the advertisement withdrawal did not finish");
            }
        }
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
    let (parts, command_rx, busy_signal) = parts(&options, lan_port.unwrap_or(0)).await?;
    let tasks = Tasks::start(
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
        tasks: tasks.joined,
        advertisement: tasks.advertisement,
    })
}

/// Everything the daemon opens before a task runs: the identity and the bridge key first, then the
/// state it reads from disk, then the advertisement the phone browses for.
async fn parts(
    options: &RunOptions,
    lan_port: u16,
) -> Result<(Parts, mpsc::Receiver<RelayCommand>, watch::Receiver<bool>)> {
    let identity = Arc::new(identity::load(&options.home)?);
    let link_key = Arc::new(link_key::LinkKey::create(&options.home)?);
    let store = Store::open(&options.home).await?;
    let (busy, busy_signal) = watch::channel(false);
    let (commands, command_rx) = mpsc::channel(RELAY_COMMANDS);
    let seen = letters::replay::Seen::open(&options.home, options.durations.letter_ttl).await?;
    let advertisement = if options.advertise {
        discovery::Advertisement::start(store.name(), &identity.public().id(), lan_port)
    } else {
        None
    };
    let mdns_host = advertisement.as_ref().map(|ad| ad.hostname());
    let parts = Parts {
        identity,
        link_key,
        store,
        offers: offers::Offers::new(),
        monitor: bridge_status::BridgeMonitor::new(),
        registry: registry::Registry::new(),
        relay: relay::handle(),
        routes: routes::Routes::new(options.relay.clone(), options.scan_interfaces, mdns_host),
        busy,
        commands,
        seen,
        advertisement,
    };
    parts.refresh_routes(lan_port);
    Ok((parts, command_rx, busy_signal))
}

async fn listen(options: &RunOptions) -> Result<(Option<TcpListener>, Option<u16>)> {
    if !options.lan {
        return Ok((None, None));
    }
    let (listener, port) = lan::bind(options.lan_port).await?;
    Ok((Some(listener), Some(port)))
}

pub async fn joined(task: JoinHandle<()>) {
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
    let term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate());
    let hup = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup());
    match (term, hup) {
        (Ok(mut terminate), Ok(mut hangup)) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
                _ = hangup.recv() => {}
            }
        }
        (Ok(mut terminate), Err(_)) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
            }
        }
        (Err(_), Ok(mut hangup)) => {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = hangup.recv() => {}
            }
        }
        (Err(_), Err(_)) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}
