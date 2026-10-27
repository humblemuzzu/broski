use std::time::Duration;

use serde_json::{json, Value};

use super::daemon::{Options, TestDaemon};
use super::feed::FakeFeed;
use super::phone::{fetch_bundle, Phone};
use super::relay::TestRelay;
use super::relay_http::{device_authorised, post_letter};

pub const WAIT: Duration = Duration::from_secs(15);
pub const POLL: Duration = Duration::from_millis(10);

/// The windows tests shrink so a scenario does not wait out the production ones.
pub fn quick_durations() -> broski_link_daemon::durations::Durations {
    broski_link_daemon::durations::Durations {
        feed_ping: Duration::from_millis(200),
        feed_pong: Duration::from_secs(2),
        feed_retry_min: Duration::from_millis(20),
        feed_retry_max: Duration::from_millis(200),
        ..Default::default()
    }
}

/// The push key every scenario registers; the vector file pins the same bytes.
pub const KEY_B64: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
pub const APNS_TOKEN: &str = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

/// A daemon and its phone, paired over the lan, with the push key registered and the relay
/// authorised for the device — the state every push and letter path starts from.
/// A fresh phone that pairs with this daemon over the lan, with nothing else set up.
pub async fn pair_lan_phone(daemon: &TestDaemon) -> Phone {
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(
        phone.pair_lan(addr, &offer).await,
        Some(false),
        "the phone pairs over the lan"
    );
    phone
}

pub struct Scenario {
    pub relay: TestRelay,
    pub daemon: TestDaemon,
    pub feed: FakeFeed,
    pub phone: Phone,
    pub machine: String,
    pub device: String,
    pub token: String,
}

impl Scenario {
    pub async fn start(
        relay: TestRelay,
        durations: broski_link_daemon::durations::Durations,
    ) -> Scenario {
        super::init_logs();
        let daemon = TestDaemon::start(Options {
            relay: Some(relay.url.clone()),
            durations,
            ..Options::default()
        })
        .await;
        let feed = FakeFeed::start(daemon.bridge_socket.clone()).await;
        let addr = daemon.lan();
        let bundle = fetch_bundle(addr).await;
        let machine = bundle.id();
        let offer = daemon.offer().await;

        let mut phone = Phone::new(bundle);
        assert_eq!(
            phone.pair_lan(addr, &offer).await,
            Some(false),
            "the phone pairs over the lan"
        );
        let (device, token) = phone.paired_credentials(WAIT).await;
        feed.await_feed(WAIT).await;
        await_relay_connected(&daemon).await;
        phone
            .send_control(json!({
                "t": "push_register",
                "platform": "apns",
                "token": APNS_TOKEN,
                "key": KEY_B64,
            }))
            .await;
        await_authorised(&relay, &machine, &device, &token).await;
        Scenario {
            relay,
            daemon,
            feed,
            phone,
            machine,
            device,
            token,
        }
    }

    pub fn address(&self) -> std::net::SocketAddr {
        self.daemon.lan()
    }

    pub fn push_registration(&self) -> Value {
        let devices: Value = serde_json::from_slice(
            &std::fs::read(self.daemon.home.join("devices.json")).expect("devices.json"),
        )
        .expect("devices.json is json");
        devices
            .as_array()
            .expect("a device list")
            .iter()
            .find(|device| device["id"] == self.device)
            .cloned()
            .expect("the paired device is stored")
    }

    /// The relay's own view of the alert targets the daemon published for this machine.
    pub async fn alert_targets(&self) -> Vec<(String, String, String)> {
        self.relay
            .hub
            .db()
            .alert_targets(&self.machine)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|target| {
                (
                    target.device,
                    target.platform.as_str().to_owned(),
                    target.token,
                )
            })
            .collect()
    }

    pub async fn await_alert_targets(&self) {
        let wanted = (
            self.device.clone(),
            "apns".to_owned(),
            APNS_TOKEN.to_owned(),
        );
        let deadline = tokio::time::Instant::now() + WAIT;
        loop {
            if self.alert_targets().await.contains(&wanted) {
                return;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "the relay never received this device as an alert target"
            );
            tokio::time::sleep(POLL).await;
        }
    }

    /// True when the relay has this machine watched: `arm_alert` answers `None` exactly while the
    /// daemon's `watch` is off.
    pub fn watched(&self) -> bool {
        self.relay
            .hub
            .room(&self.machine)
            .is_some_and(|room| room.arm_alert().is_some())
    }

    pub async fn await_watched(&self, watched: bool) {
        let deadline = tokio::time::Instant::now() + WAIT;
        while self.watched() != watched {
            assert!(
                tokio::time::Instant::now() < deadline,
                "the relay never saw watch={watched}"
            );
            tokio::time::sleep(POLL).await;
        }
    }

    /// Waits until the daemon reports the phone's session as attached or detached.
    pub async fn await_session(&self, connected: bool) {
        let short = &self.device[..8];
        let deadline = tokio::time::Instant::now() + WAIT;
        loop {
            let status = self.daemon.ask(json!({"cmd": "status"})).await;
            let attached = status["sessions"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .any(|session| session["device"] == short && session["connected"] == connected);
            if attached {
                return;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "the daemon never reported the session as connected={connected}: {status}"
            );
            tokio::time::sleep(POLL).await;
        }
    }

    pub async fn post_letter(&self, data: &[u8]) -> (u16, Value) {
        post_letter(
            self.relay.addr,
            &self.machine,
            &self.device,
            &self.token,
            data,
        )
        .await
    }

    /// Waits until the relay has retired the letter, which only its ack does.
    pub async fn await_acked(&self, id: u64) {
        let deadline = tokio::time::Instant::now() + WAIT;
        loop {
            let pending = self
                .relay
                .hub
                .db()
                .pending_letters(&self.machine, 0)
                .await
                .unwrap_or_default();
            if !pending.iter().any(|letter| letter.id == id) {
                return;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "letter {id} was never acknowledged"
            );
            tokio::time::sleep(POLL).await;
        }
    }

    pub async fn stop(self) {
        self.daemon.stop().await;
        self.feed.stop().await;
        self.relay.stop().await;
    }
}

async fn await_relay_connected(daemon: &TestDaemon) {
    let deadline = tokio::time::Instant::now() + WAIT;
    loop {
        if daemon.ask(json!({"cmd": "status"})).await["relay_connected"] == true {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the daemon never connected to the relay"
        );
        tokio::time::sleep(POLL).await;
    }
}

async fn await_authorised(relay: &TestRelay, machine: &str, device: &str, token: &str) {
    let deadline = tokio::time::Instant::now() + WAIT;
    while !device_authorised(relay.addr, machine, device, token).await {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the relay never authorised the paired device"
        );
        tokio::time::sleep(POLL).await;
    }
}
