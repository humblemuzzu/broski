use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use broski_relay::hub::Hub;
use broski_relay::limits::{Limits, RateLimit};
use broski_relay::push::PushConfig;
use broski_relay::Options;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::common::{Client, DEVICE_HEADER, MACHINE_HEADER, WAIT};

pub struct Relay {
    pub addr: SocketAddr,
    pub db: PathBuf,
    dir: Option<tempfile::TempDir>,
    hub: Arc<Hub>,
    rate: RateLimit,
    limits: Limits,
    push: PushConfig,
    stop: Option<oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<std::io::Result<()>>>,
}

impl Relay {
    pub async fn start() -> Relay {
        Self::start_with(RateLimit::default()).await
    }

    pub async fn start_with(rate: RateLimit) -> Relay {
        Self::start_configured(rate, Limits::default(), PushConfig::default()).await
    }

    pub async fn start_configured(rate: RateLimit, limits: Limits, push: PushConfig) -> Relay {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = dir.path().join("relay.db");
        Self::boot(Some(dir), db, rate, limits, push).await
    }

    async fn boot(
        dir: Option<tempfile::TempDir>,
        db: PathBuf,
        rate: RateLimit,
        limits: Limits,
        push: PushConfig,
    ) -> Relay {
        let hub = broski_relay::open(Options {
            db_path: db.clone(),
            rate,
            limits,
            push: push.clone(),
        })
        .await
        .expect("open relay");
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");
        let (stop, stopped) = oneshot::channel();
        let serving = hub.clone();
        let task = tokio::spawn(broski_relay::serve(listener, serving, async move {
            let _ = stopped.await;
        }));
        Relay {
            addr,
            db,
            dir,
            hub,
            rate,
            limits,
            push,
            stop: Some(stop),
            task: Some(task),
        }
    }

    pub fn hub(&self) -> Arc<Hub> {
        self.hub.clone()
    }

    pub async fn machine(&self, id: &str, secret: &str) -> Result<Client, u16> {
        let authorization = format!("Bearer {secret}");
        Client::connect(
            self.addr,
            "/v1/machine",
            &[(MACHINE_HEADER, id), ("authorization", &authorization)],
        )
        .await
    }

    pub async fn device(
        &self,
        machine_id: &str,
        device_id: &str,
        token: &str,
    ) -> Result<Client, u16> {
        let authorization = format!("Bearer {token}");
        Client::connect(
            self.addr,
            "/v1/device",
            &[
                (MACHINE_HEADER, machine_id),
                (DEVICE_HEADER, device_id),
                ("authorization", &authorization),
            ],
        )
        .await
    }

    pub async fn registered(&self, seed: u8) -> (Client, String) {
        let bundle = crate::common::bundle_of(seed);
        let id = crate::common::machine_id(&bundle);
        let mut machine = self
            .machine(&id, "secret")
            .await
            .expect("machine registers");
        assert_eq!(machine.publish(&bundle).await["t"], "ok");
        (machine, id)
    }

    pub async fn stop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            let _ = tokio::time::timeout(WAIT, task).await;
        }
    }

    pub async fn restart(mut self) -> Relay {
        self.stop().await;
        let dir = self.dir.take();
        let db = self.db.clone();
        let rate = self.rate;
        let limits = self.limits;
        let push = self.push.clone();
        drop(self);
        Self::boot(dir, db, rate, limits, push).await
    }
}
