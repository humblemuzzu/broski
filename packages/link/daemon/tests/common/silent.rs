use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::task::JoinHandle;

/// A socket that accepts and never answers the upgrade, so the daemon's dial has to time out.
/// Dialling is recorded by the role in the request headers, which arrive before the handshake.
pub struct SilentBridge {
    pub socket: PathBuf,
    dials: Arc<Mutex<Vec<String>>>,
    task: JoinHandle<()>,
}

impl SilentBridge {
    pub async fn start(socket: PathBuf) -> SilentBridge {
        let listener = UnixListener::bind(&socket).expect("bind the silent bridge");
        let dials: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&dials);
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let recorded = Arc::clone(&recorded);
                tokio::spawn(async move { hold(stream, recorded).await });
            }
        });
        SilentBridge {
            socket,
            dials,
            task,
        }
    }

    /// How many dials carried this `x-broski-role`.
    pub fn dials(&self, role: &str) -> usize {
        self.lock().iter().filter(|seen| *seen == role).count()
    }

    /// Waits until this many dials of `role` have arrived, then reports whether they did.
    pub async fn await_dials(&self, role: &str, count: usize, budget: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + budget;
        loop {
            if self.dials(role) >= count {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    pub fn stop(self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<String>> {
        self.dials.lock().unwrap_or_else(|error| error.into_inner())
    }
}

async fn hold(stream: UnixStream, dials: Arc<Mutex<Vec<String>>>) {
    let mut reader = BufReader::new(stream);
    let mut role = String::new();
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("x-broski-role") {
                role = value.trim().to_owned();
            }
        }
    }
    dials
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .push(role);
    std::future::pending::<()>().await;
}
