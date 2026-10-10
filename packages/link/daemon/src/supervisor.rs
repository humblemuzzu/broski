use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::backoff::Backoff;
use crate::bridge_status::{BridgeMonitor, Supervision};

const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const HEALTHY: Duration = Duration::from_secs(60);

/// `--bridge-cmd <program> [args...]`: the daemon owns the bridge process.
#[derive(Clone)]
pub struct Supervisor {
    requests: mpsc::Sender<Request>,
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
    pub fn restart(&self) -> bool {
        self.requests.try_send(Request::Restart).is_ok()
    }
}

pub fn spawn(
    command: Vec<String>,
    socket: PathBuf,
    monitor: Arc<BridgeMonitor>,
) -> Option<(Supervisor, JoinHandle<()>)> {
    let (program, args) = command.split_first()?;
    let (program, args) = (program.clone(), args.to_vec());
    let (requests, rx) = mpsc::channel(4);
    let task = tokio::spawn(run(program, args, socket, monitor, rx));
    Some((Supervisor { requests }, task))
}

async fn run(
    program: String,
    args: Vec<String>,
    socket: PathBuf,
    monitor: Arc<BridgeMonitor>,
    mut requests: mpsc::Receiver<Request>,
) {
    let mut backoff = Backoff::new(BACKOFF_MIN, BACKOFF_MAX);
    loop {
        monitor.supervised(Supervision::Starting, None);
        let started = Instant::now();
        let outcome = attempt(&program, &args, &socket, &mut requests).await;
        report(&outcome, &monitor);
        match outcome {
            Outcome::Stop => return,
            Outcome::Restart => {
                backoff.reset();
                continue;
            }
            _ => {
                if started.elapsed() >= HEALTHY {
                    backoff.reset();
                }
                tokio::time::sleep(backoff.next()).await;
            }
        }
    }
}

async fn attempt(
    program: &str,
    args: &[String],
    socket: &Path,
    requests: &mut mpsc::Receiver<Request>,
) -> Outcome {
    match start(program, args, socket).await {
        Ok(mut child) => supervise(&mut child, requests).await,
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

async fn supervise(child: &mut Child, requests: &mut mpsc::Receiver<Request>) -> Outcome {
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
    }
}

async fn start(program: &str, args: &[String], socket: &Path) -> Result<Child, String> {
    let mut child = Command::new(program)
        .args(args)
        .arg("--link-socket")
        .arg(socket)
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
