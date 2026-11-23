use std::sync::Arc;

use broski_link_core::crypto::StaticIdentity;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio::task::{JoinHandle, JoinSet};
use zeroize::Zeroizing;

use crate::bridge_status::BridgeMonitor;
use crate::control_socket::{self, Control};
use crate::dialogs::{self, MacDialog};
use crate::discovery::Advertisement;
use crate::feed;
use crate::lan::Lan;
use crate::letters;
use crate::link_key::LinkKey;
use crate::offers::Offers;
use crate::power_policy;
use crate::registry::Registry;
use crate::relay::{self, RelayCommand, RelayHandle};
use crate::responder::Responder;
use crate::routes;
use crate::routes::Routes;
use crate::session::SessionDeps;
use crate::store::Store;
use crate::supervisor::{self, Supervisor};
use crate::{joined, RunOptions};

/// Everything a task needs from the daemon, before any of it is moved into one.
pub struct Parts {
    pub identity: Arc<StaticIdentity>,
    pub link_key: Arc<LinkKey>,
    pub store: Arc<Store>,
    pub offers: Arc<Offers>,
    pub monitor: Arc<BridgeMonitor>,
    pub registry: Arc<Registry>,
    pub relay: RelayHandle,
    pub routes: Routes,
    pub busy: watch::Sender<bool>,
    pub dialogs: watch::Sender<Vec<MacDialog>>,
    pub commands: mpsc::Sender<RelayCommand>,
    pub seen: Arc<letters::replay::Seen>,
    pub advertisement: Option<Arc<Advertisement>>,
}

impl Parts {
    pub fn refresh_routes(&self, port: u16) {
        self.routes.refresh(port);
    }
}

/// The running daemon's tasks, and the advertisement that has to be withdrawn on the way out.
pub struct Tasks {
    pub joined: JoinSet<()>,
    pub advertisement: Option<Arc<Advertisement>>,
}

impl Tasks {
    pub async fn start(
        options: &RunOptions,
        listener: Option<TcpListener>,
        lan_port: u16,
        parts: Parts,
        commands: mpsc::Receiver<RelayCommand>,
        busy: watch::Receiver<bool>,
        shutdown: watch::Receiver<bool>,
    ) -> crate::Result<Tasks> {
        let mut joined_set: JoinSet<()> = JoinSet::new();
        joined_set.spawn(joined(routes::spawn(
            parts.routes.clone(),
            lan_port,
            parts.advertisement.clone(),
            shutdown.clone(),
        )));
        let (supervisor, supervisor_task) = supervise(options, &parts, shutdown.clone());
        if let Some(task) = supervisor_task {
            joined_set.spawn(joined(task));
        }
        let responder = Arc::new(make_responder(
            options,
            &parts,
            supervisor,
            shutdown.clone(),
        ));
        let feed = spawn_feed(options, &parts, shutdown.clone(), &mut joined_set);
        let letters = spawn_letters(options, &parts, feed, shutdown.clone(), &mut joined_set);
        joined_set.spawn(joined(spawn_power(options, &parts, shutdown.clone())));
        if options.watch_dialogs {
            joined_set.spawn(joined(dialogs::watcher::spawn(
                dialogs::watcher::Deps {
                    machine_id: parts.identity.public().id(),
                    store: parts.store.clone(),
                    registry: parts.registry.clone(),
                    relay: parts.commands.clone(),
                    tx: parts.dialogs.clone(),
                },
                shutdown.clone(),
            )));
        }
        joined_set.spawn(joined(
            spawn_control(options, &parts, shutdown.clone()).await?,
        ));
        if let Some(listener) = listener {
            joined_set.spawn(joined(serve_lan(
                listener,
                Arc::clone(&responder),
                &parts.identity,
                shutdown.clone(),
            )));
        }
        if let Some(task) = spawn_relay(
            options, &parts, responder, commands, busy, letters, shutdown,
        ) {
            joined_set.spawn(joined(task));
        }
        Ok(Tasks {
            joined: joined_set,
            advertisement: parts.advertisement,
        })
    }
}

fn session_deps(
    options: &RunOptions,
    parts: &Parts,
    supervisor: Option<Supervisor>,
    shutdown: watch::Receiver<bool>,
) -> Arc<SessionDeps> {
    Arc::new(SessionDeps {
        machine_id: parts.identity.public().id(),
        machine_name: parts.store.name().to_owned(),
        bridge_socket: options.bridge_socket.clone(),
        link_key: Arc::clone(&parts.link_key),
        monitor: parts.monitor.clone(),
        supervisor,
        store: parts.store.clone(),
        routes: parts.routes.clone(),
        offers: parts.offers.clone(),
        relay: parts.relay.clone(),
        dialogs: parts.dialogs.subscribe(),
        screen_port: options.screen_port,
        shutdown,
        idle_limit: options.durations.session_idle,
        dial_timeout: options.durations.dial_timeout,
        handshake_timeout: options.durations.handshake_timeout,
    })
}

fn make_responder(
    options: &RunOptions,
    parts: &Parts,
    supervisor: Option<Supervisor>,
    shutdown: watch::Receiver<bool>,
) -> Responder {
    Responder {
        identity: parts.identity.clone(),
        store: parts.store.clone(),
        offers: parts.offers.clone(),
        registry: parts.registry.clone(),
        relay: parts.relay.clone(),
        deps: session_deps(options, parts, supervisor, shutdown),
    }
}

fn supervise(
    options: &RunOptions,
    parts: &Parts,
    shutdown: watch::Receiver<bool>,
) -> (Option<Supervisor>, Option<JoinHandle<()>>) {
    let command = options.bridge_cmd.clone().unwrap_or_default();
    match supervisor::spawn(
        command,
        options.bridge_socket.clone(),
        Arc::clone(&parts.link_key),
        parts.monitor.clone(),
        shutdown,
    ) {
        Some((supervisor, task)) => (Some(supervisor), Some(task)),
        None => (None, None),
    }
}

fn spawn_feed(
    options: &RunOptions,
    parts: &Parts,
    shutdown: watch::Receiver<bool>,
    joined_set: &mut JoinSet<()>,
) -> feed::Handle {
    let (handle, task) = feed::spawn(
        feed::Deps {
            socket: options.bridge_socket.clone(),
            link_key: Arc::clone(&parts.link_key),
            machine_id: parts.identity.public().id(),
            store: parts.store.clone(),
            registry: parts.registry.clone(),
            relay: parts.commands.clone(),
            busy: parts.busy.clone(),
            monitor: parts.monitor.clone(),
            durations: options.durations,
        },
        shutdown,
    );
    joined_set.spawn(joined(task));
    handle
}

fn spawn_letters(
    options: &RunOptions,
    parts: &Parts,
    feed: feed::Handle,
    shutdown: watch::Receiver<bool>,
    joined_set: &mut JoinSet<()>,
) -> mpsc::Sender<letters::Incoming> {
    let pipes = letters::pipe::Pipes::new(
        options.bridge_socket.clone(),
        Arc::clone(&parts.link_key),
        options.durations.dial_timeout,
        options.durations.bridge_letter_hold,
    );
    let (incoming, task) = letters::spawn(
        Arc::new(letters::Deps {
            store: parts.store.clone(),
            link_key: Arc::clone(&parts.link_key),
            registry: parts.registry.clone(),
            seen: parts.seen.clone(),
            feed,
            pipes,
            relay: parts.commands.clone(),
            machine_id: parts.identity.public().id(),
            durations: options.durations,
        }),
        shutdown,
    );
    joined_set.spawn(joined(task));
    incoming
}

fn spawn_power(
    options: &RunOptions,
    parts: &Parts,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    power_policy::spawn(
        power_policy::Deps {
            busy: parts.busy.subscribe(),
            relay: parts.commands.clone(),
            durations: options.durations,
        },
        shutdown,
    )
}

async fn spawn_control(
    options: &RunOptions,
    parts: &Parts,
    shutdown: watch::Receiver<bool>,
) -> crate::Result<JoinHandle<()>> {
    control_socket::prepare(&control_socket::path(&options.home)).await?;
    let control = Arc::new(Control {
        home: options.home.clone(),
        identity: parts.identity.clone(),
        store: parts.store.clone(),
        offers: parts.offers.clone(),
        routes: parts.routes.clone(),
        monitor: parts.monitor.clone(),
        registry: parts.registry.clone(),
        relay: parts.relay.clone(),
    });
    control_socket::spawn(control, shutdown)
}

fn serve_lan(
    listener: TcpListener,
    responder: Arc<Responder>,
    identity: &StaticIdentity,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    let lan = Lan::new(responder, identity);
    tokio::spawn(async move {
        if let Err(error) = crate::lan::serve(listener, lan, shutdown).await {
            tracing::debug!(error = %error, "lan listener stopped");
        }
    })
}

#[allow(clippy::too_many_arguments)]
fn spawn_relay(
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
        public: crate::codec::b64url(&parts.identity.public().to_bytes()),
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
