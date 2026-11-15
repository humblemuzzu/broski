use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use broski_relay::hub::Hub;
use broski_relay::limits::{Limits, RateLimit};
use broski_relay::push::PushConfig;
use broski_relay::Options;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// The real relay on a loopback port with a throwaway database. The per-IP upgrade bucket is
/// opened up: every socket of a test comes from 127.0.0.1, and the session's reconnects are what
/// the tests exercise, not the relay's rate limit.
pub struct TestRelay {
    pub addr: SocketAddr,
    pub url: String,
    pub hub: Arc<Hub>,
    dir: TempDir,
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl TestRelay {
    pub async fn start() -> TestRelay {
        let dir = tempfile::tempdir().expect("relay dir");
        let hub = broski_relay::open(Options {
            db_path: dir.path().join("relay.db"),
            rate: RateLimit {
                burst: 10_000.0,
                per_second: 10_000.0,
            },
            limits: Limits {
                sweep_interval: Duration::from_secs(3600),
                ..Limits::default()
            },
            push: PushConfig::default(),
        })
        .await
        .expect("open the relay");
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the relay");
        let addr = listener.local_addr().expect("relay addr");
        let (stop, stopped) = oneshot::channel();
        let serving = Arc::clone(&hub);
        let task = tokio::spawn(async move {
            let _ = broski_relay::serve(listener, serving, async move {
                let _ = stopped.await;
            })
            .await;
        });
        TestRelay {
            addr,
            url: format!("ws://{addr}"),
            hub,
            dir,
            stop: Some(stop),
            task,
        }
    }

    pub async fn stop(mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let _ = self.task.await;
        drop(self.dir);
    }
}
