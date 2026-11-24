use std::net::SocketAddr;
use std::sync::Arc;

use broski_relay::hub::Hub;
use broski_relay::limits::{Limits, RateLimit};
use broski_relay::push::PushConfig;
use broski_relay::Options;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// The real relay on a loopback port with a throwaway database.
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
        TestRelay::start_with(PushConfig::default(), Limits::default()).await
    }

    pub async fn start_with(push: PushConfig, limits: Limits) -> TestRelay {
        let dir = tempfile::tempdir().expect("relay dir");
        let limits = Limits {
            sweep_interval: std::time::Duration::from_secs(3600),
            ..limits
        };
        let hub = broski_relay::open(Options {
            db_path: dir.path().join("relay.db"),
            rate: RateLimit::default(),
            limits,
            push,
            register_token: None,
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
