use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::Instant;

use tokio::io::{AsyncBufReadExt, AsyncRead};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::backoff::{self, Backoff};
use crate::bridge_status::{BridgeMonitor, Supervision};
use crate::link_key::LinkKey;
use crate::stop::stopped;

const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const HEALTHY: Duration = Duration::from_secs(60);
/// A restart asked for over the link is honoured at most this often: a paired phone cannot respawn
/// the bridge faster than the supervisor itself would.
const MIN_RESTART_INTERVAL: Duration = Duration::from_secs(1);

/// `--bridge-cmd <program> [args...]`: the daemon owns the bridge process.
#[derive(Clone)]
pub struct Supervisor {
    requests: mpsc::Sender<Request>,
    last_restart: Arc<Mutex<Option<Instant>>>,
}

enum Request {
    Restart,
}

enum Outcome {
    Exited(String),
    SpawnFailed(String),
    Restart,
    Stop,
}

impl Supervisor {
    /// False when another restart was accepted within `MIN_RESTART_INTERVAL`.
    pub fn restart(&self) -> bool {
        let mut last = self
            .last_restart
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if last.is_some_and(|at| at.elapsed() < MIN_RESTART_INTERVAL) {
            return false;
        }
        if self.requests.try_send(Request::Restart).is_err() {
            return false;
        }
        *last = Some(Instant::now());
        true
    }
}

pub fn spawn(
    command: Vec<String>,
    socket: PathBuf,
    key: Arc<LinkKey>,
    monitor: Arc<BridgeMonitor>,
    shutdown: watch::Receiver<bool>,
) -> Option<(Supervisor, JoinHandle<()>)> {
    let (program, args) = command.split_first()?;
    let (program, args) = (program.clone(), args.to_vec());
    let (requests, rx) = mpsc::channel(4);
    let task = tokio::spawn(run(program, args, socket, key, monitor, rx, shutdown));
    Some((
        Supervisor {
            requests,
            last_restart: Arc::new(Mutex::new(None)),
        },
        task,
    ))
}

async fn run(
    program: String,
    args: Vec<String>,
    socket: PathBuf,
    key: Arc<LinkKey>,
    monitor: Arc<BridgeMonitor>,
    mut requests: mpsc::Receiver<Request>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut backoff = Backoff::new(BACKOFF_MIN, BACKOFF_MAX);
    loop {
        if *shutdown.borrow() {
            return;
        }
        monitor.supervised(Supervision::Starting, None);
        let started = Instant::now();
        let outcome = attempt(&program, &args, &socket, &key, &mut requests, &mut shutdown).await;
        report(&outcome, &monitor);
        if let Outcome::Stop = outcome {
            return;
        }
        // A restart asked for by the phone is a run that ended early like any other: it counts
        // against the backoff, which is what keeps a phone from respawning the bridge in a loop.
        if backoff::healthy(started, HEALTHY) {
            backoff.reset();
        }
        tokio::select! {
            _ = tokio::time::sleep(backoff.next()) => {}
            _ = stopped(&mut shutdown) => return,
        }
    }
}

async fn attempt(
    program: &str,
    args: &[String],
    socket: &Path,
    key: &LinkKey,
    requests: &mut mpsc::Receiver<Request>,
    shutdown: &mut watch::Receiver<bool>,
) -> Outcome {
    match start(program, args, socket, key).await {
        Ok(mut child) => supervise(&mut child, requests, shutdown).await,
        Err(error) => Outcome::SpawnFailed(error),
    }
}

fn report(outcome: &Outcome, monitor: &Arc<BridgeMonitor>) {
    match outcome {
        Outcome::Exited(detail) => {
            warn!(detail = %detail, "bridge process ended");
            monitor.supervised(Supervision::Crashed, Some(detail.clone()));
        }
        Outcome::SpawnFailed(error) => {
            warn!(error = %error, "bridge process not started");
            monitor.supervised(Supervision::Crashed, Some(error.clone()));
        }
        Outcome::Restart | Outcome::Stop => {}
    }
}

async fn supervise(
    child: &mut Child,
    requests: &mut mpsc::Receiver<Request>,
    shutdown: &mut watch::Receiver<bool>,
) -> Outcome {
    tokio::select! {
        status = child.wait() => match status {
            Ok(status) => Outcome::Exited(format!("bridge exited with {status}")),
            Err(error) => Outcome::Exited(format!("bridge wait failed: {error}")),
        },
        request = requests.recv() => match request {
            Some(Request::Restart) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                warn!("bridge restart requested");
                Outcome::Restart
            }
            None => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                Outcome::Stop
            }
        },
        _ = stopped(shutdown) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Outcome::Stop
        }
    }
}

async fn start(
    program: &str,
    args: &[String],
    socket: &Path,
    key: &LinkKey,
) -> Result<Child, String> {
    let mut child = Command::new(program)
        .args(args)
        .arg("--link-socket")
        .arg(socket)
        .arg("--link-key-file")
        .arg(key.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("cannot start {program}: {error}"))?;
    if let Some(stdout) = child.stdout.take() {
        forward(stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        forward(stderr);
    }
    Ok(child)
}

fn forward<R: AsyncRead + Unpin + Send + 'static>(reader: R) {
    tokio::spawn(async move {
        let mut lines = tokio::io::BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!(target: "broski_link::bridge_process", "{line}");
        }
    });
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn supervisor() -> (Supervisor, mpsc::Receiver<Request>) {
        let (requests, rx) = mpsc::channel(4);
        (
            Supervisor {
                requests,
                last_restart: Arc::new(Mutex::new(None)),
            },
            rx,
        )
    }

    #[tokio::test]
    async fn a_second_restart_inside_the_window_is_refused() {
        let (supervisor, mut rx) = supervisor();
        assert!(supervisor.restart(), "the first restart is accepted");
        assert!(
            rx.recv().await.is_some(),
            "the supervisor was asked to restart"
        );
        assert!(
            !supervisor.restart(),
            "a second restart inside the window is refused"
        );

        tokio::time::sleep(MIN_RESTART_INTERVAL + Duration::from_millis(20)).await;
        assert!(
            supervisor.restart(),
            "the window passing lets a restart through again"
        );
    }
}
