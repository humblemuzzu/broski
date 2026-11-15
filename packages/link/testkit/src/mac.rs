use std::path::PathBuf;

use tempfile::TempDir;

use crate::await_identity;
use crate::bridge::FakeBridge;
use crate::daemon::{Home, TestDaemon};
use crate::forwarder::Forwarder;
use crate::relay::TestRelay;

/// One machine: the real daemon, the real bridge on its socket, and the directory the bridge serves.
pub struct Mac {
    pub home: Home,
    root: TempDir,
    pub daemon: Option<TestDaemon>,
    pub bridge: FakeBridge,
    /// The LAN path the phone dials, which the test can cut.
    pub lan: Option<Forwarder>,
    relay: Option<String>,
}

impl Mac {
    /// A machine the phone reaches over the LAN, through a forwarder.
    pub async fn on_lan() -> Mac {
        let home = Home::new();
        let daemon = TestDaemon::start(&home, None, true).await;
        let lan = Forwarder::start(daemon.lan()).await;
        Mac::serve(home, daemon, Some(lan), None).await
    }

    /// A machine the phone reaches through `relay` only, so it can restart on another LAN port.
    pub async fn on_relay(relay: &TestRelay) -> Mac {
        let home = Home::new();
        let daemon = TestDaemon::start(&home, Some(&relay.url), false).await;
        await_identity(relay, &daemon).await;
        Mac::serve(home, daemon, None, Some(relay.url.clone())).await
    }

    async fn serve(
        home: Home,
        daemon: TestDaemon,
        lan: Option<Forwarder>,
        relay: Option<String>,
    ) -> Mac {
        let root = tempfile::tempdir().expect("the bridge's home");
        let real = std::fs::canonicalize(root.path()).expect("canonical");
        let bridge = FakeBridge::start(&home, &real).await;
        Mac {
            home,
            root,
            daemon: Some(daemon),
            bridge,
            lan,
            relay,
        }
    }

    /// The bridge's home, spelled as the bridge spells it.
    pub fn root(&self) -> PathBuf {
        std::fs::canonicalize(self.root.path()).expect("canonical")
    }

    pub fn root_text(&self) -> String {
        self.root().to_string_lossy().into_owned()
    }

    pub async fn offer(&self) -> String {
        let mut offer = self.daemon().offer().await;
        offer.lan = self.lan.iter().map(Forwarder::route).collect();
        offer.to_uri()
    }

    /// An offer straight to the daemon's LAN listener, past the forwarder a test cuts.
    pub async fn direct_offer(&self) -> String {
        let mut offer = self.daemon().offer().await;
        offer.lan = vec![self.daemon().lan().to_string()];
        offer.to_uri()
    }

    pub fn daemon(&self) -> &TestDaemon {
        self.daemon.as_ref().expect("the daemon runs")
    }

    pub async fn stop_daemon(&mut self) {
        self.daemon.take().expect("the daemon runs").stop().await;
    }

    /// The machine starts its daemon again on the same home: a new link session for every phone.
    pub async fn start_daemon(&mut self) {
        let daemon = TestDaemon::start(&self.home, self.relay.as_deref(), self.lan.is_some()).await;
        self.daemon = Some(daemon);
    }
}
