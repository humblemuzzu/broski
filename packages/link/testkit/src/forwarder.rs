use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::{AbortHandle, JoinHandle};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    /// Every connection is piped to the daemon, after `delay`.
    Open { delay: Duration },
    /// Connections are accepted and wait, unanswered, until the mode changes.
    Held,
    /// The network is gone: connections are accepted and dropped at once.
    Cut,
}

/// A LAN path to the daemon the test controls: it can delay, hold, cut and drop connections, and
/// counts every one the phone opened.
pub struct Forwarder {
    pub addr: SocketAddr,
    mode: watch::Sender<Mode>,
    /// Bumped by `stall`: a connection made before the bump stops moving bytes.
    stalls: watch::Sender<u64>,
    accepted: Arc<AtomicUsize>,
    pipes: Arc<Mutex<Vec<AbortHandle>>>,
    task: JoinHandle<()>,
}

impl Forwarder {
    pub async fn start(upstream: SocketAddr) -> Forwarder {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the forwarder");
        let addr = listener.local_addr().expect("forwarder addr");
        let (mode, modes) = watch::channel(Mode::Open {
            delay: Duration::ZERO,
        });
        let (stalls, stalled) = watch::channel(0);
        let accepted = Arc::new(AtomicUsize::new(0));
        let pipes = Arc::new(Mutex::new(Vec::new()));
        let task = tokio::spawn(accept(
            listener,
            upstream,
            (modes, stalled),
            Arc::clone(&accepted),
            Arc::clone(&pipes),
        ));
        Forwarder {
            addr,
            mode,
            stalls,
            accepted,
            pipes,
            task,
        }
    }

    /// The LAN route the phone dials.
    pub fn route(&self) -> String {
        self.addr.to_string()
    }

    pub fn accepted(&self) -> usize {
        self.accepted.load(Ordering::SeqCst)
    }

    pub fn delay(&self, delay: Duration) {
        self.mode.send_replace(Mode::Open { delay });
    }

    pub fn hold(&self) {
        self.mode.send_replace(Mode::Held);
    }

    pub fn release(&self) {
        self.delay(Duration::ZERO);
    }

    /// Kills every live connection and refuses the next ones.
    pub fn cut(&self) {
        self.mode.send_replace(Mode::Cut);
        self.drop_connections();
    }

    /// Every live connection goes silent without closing, as one does when a cell handoff or a
    /// NAT drops it; new connections still pass.
    pub fn stall(&self) {
        self.stalls.send_modify(|stalls| *stalls += 1);
    }

    /// Kills every live connection, as a Wi-Fi drop does, and keeps accepting new ones.
    pub fn drop_connections(&self) {
        for pipe in self
            .pipes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
        {
            pipe.abort();
        }
    }

    pub fn stop(self) {
        self.drop_connections();
        self.task.abort();
    }
}

async fn accept(
    listener: TcpListener,
    upstream: SocketAddr,
    (modes, stalls): (watch::Receiver<Mode>, watch::Receiver<u64>),
    accepted: Arc<AtomicUsize>,
    pipes: Arc<Mutex<Vec<AbortHandle>>>,
) {
    while let Ok((client, _)) = listener.accept().await {
        accepted.fetch_add(1, Ordering::SeqCst);
        let mut stalls = stalls.clone();
        stalls.mark_unchanged();
        let pipe = tokio::spawn(pipe(client, upstream, modes.clone(), stalls));
        pipes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(pipe.abort_handle());
    }
}

async fn pipe(
    mut client: TcpStream,
    upstream: SocketAddr,
    mut modes: watch::Receiver<Mode>,
    mut stalls: watch::Receiver<u64>,
) {
    let Ok(mode) = modes
        .wait_for(|mode| *mode != Mode::Held)
        .await
        .map(|mode| *mode)
    else {
        return;
    };
    let delay = match mode {
        Mode::Open { delay } => delay,
        Mode::Held | Mode::Cut => return,
    };
    tokio::time::sleep(delay).await;
    let Ok(mut server) = TcpStream::connect(upstream).await else {
        return;
    };
    tokio::select! {
        _ = tokio::io::copy_bidirectional(&mut client, &mut server) => {}
        _ = stalls.changed() => {
            // Both sockets stay open and nothing crosses: no FIN, no RST, just silence.
            std::future::pending::<()>().await;
        }
    }
}
