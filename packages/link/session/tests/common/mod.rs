#![allow(dead_code)]

pub mod bridge;
pub mod daemon;
pub mod forwarder;
pub mod relay;
pub mod watch;

use std::sync::Once;
use std::time::Duration;

use broski_link_session::{
    pair, DeviceIdentity, LinkRuntime, MachineRecord, Offer, Paired, Platform, SessionOptions,
    Timings,
};
use serde_json::json;
use tokio::time::Instant;

use self::daemon::TestDaemon;
use self::relay::TestRelay;
use self::watch::WAIT;

/// A phone that only has the offer fetches the machine's identity from the relay, which has it
/// once the daemon's relay socket published it.
pub async fn await_identity(relay: &TestRelay, daemon: &TestDaemon) {
    let status = daemon.ask(json!({"cmd": "status"})).await;
    let machine = status["machine"]["id"]
        .as_str()
        .expect("machine id")
        .to_owned();
    let deadline = Instant::now() + WAIT;
    while relay
        .hub
        .db()
        .identity(&machine)
        .await
        .ok()
        .flatten()
        .is_none()
    {
        assert!(
            Instant::now() < deadline,
            "the machine never published its identity"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

pub fn init_logs() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("off"));
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_test_writer()
            .try_init();
    });
}

/// The production windows, with the ones a test would otherwise wait out shrunk.
pub fn quick() -> Timings {
    Timings {
        probe_interval: Duration::from_millis(200),
        backoff_min: Duration::from_millis(50),
        backoff_max: Duration::from_millis(500),
        ..Timings::default()
    }
}

pub fn options(timings: Timings) -> SessionOptions {
    SessionOptions {
        device_name: "test phone".to_owned(),
        platform: Platform::Ios,
        timings,
    }
}

/// The phone side of a test: one runtime, one device identity.
pub struct Phone {
    pub runtime: LinkRuntime,
    pub identity: DeviceIdentity,
}

impl Phone {
    pub fn new() -> Phone {
        init_logs();
        Phone {
            runtime: LinkRuntime::new().expect("runtime"),
            identity: DeviceIdentity::generate().expect("identity"),
        }
    }

    /// A valid record of a machine that nothing answers for: its one LAN route is a closed port.
    pub fn record_nobody_serves(&self) -> MachineRecord {
        let machine = DeviceIdentity::generate().expect("identity");
        let closed = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|listener| listener.local_addr())
            .expect("a free port");
        MachineRecord {
            id: machine.id(),
            name: "nobody".into(),
            os: None,
            public_bundle: machine.public_bundle(),
            device_id: self.identity.id(),
            relay: None,
            relay_token: None,
            lan: vec![closed.to_string()],
            push_key: vec![7; 32],
            paired_at_ms: 0,
        }
    }

    /// Pairs with the offer `daemon` produced, its LAN candidates replaced with `lan`: the
    /// daemon's own candidates are the host's interface addresses, which a CI host may not have.
    pub async fn pair(&self, daemon: &TestDaemon, lan: Vec<String>, timings: Timings) -> Paired {
        let mut offer = daemon.offer().await;
        offer.lan = lan;
        let offer = Offer::parse(&offer.to_uri()).expect("the offer parses");
        pair(&self.runtime, &self.identity, offer, options(timings))
            .await
            .expect("the phone pairs")
    }
}
