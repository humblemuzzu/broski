mod common;

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use broski_link_core::crypto::{PairingOffer, PublicBundle};
use broski_link_daemon::pairing;
use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::Phone;
use common::relay::TestRelay;
use common::relay_http::{device_authorised, machine_bundle};

const WAIT: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(50);

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn wait_for_bundle(relay: SocketAddr, machine: &str) -> PublicBundle {
    let deadline = Instant::now() + WAIT;
    loop {
        if let Some(bundle) = machine_bundle(relay, machine).await {
            return bundle;
        }
        assert!(
            Instant::now() < deadline,
            "the relay never published the machine identity"
        );
        tokio::time::sleep(POLL).await;
    }
}

/// The relay needs a moment to authorise a device the machine just paired.
async fn wait_for_pairing_device(relay: SocketAddr, machine: &str, device: &str, token: &str) {
    let deadline = Instant::now() + WAIT;
    while !device_authorised(relay, machine, device, token).await {
        assert!(
            Instant::now() < deadline,
            "the relay never authorised the pairing device"
        );
        tokio::time::sleep(POLL).await;
    }
}

/// Pairs over the relay as the offer's derived device and hands back the phone with its real
/// credentials; also pins that the pairing device cannot connect.
async fn pair(relay: SocketAddr, machine: &str, offer: &PairingOffer) -> (Phone, String, String) {
    let pairing_device = pairing::device_id(&offer.secret);
    let pairing_token = pairing::token(&offer.secret);
    let bundle = wait_for_bundle(relay, machine).await;
    wait_for_pairing_device(relay, machine, &pairing_device, &pairing_token).await;

    let mut phone = Phone::new(bundle);
    assert_eq!(
        phone
            .connect_relay(
                relay,
                machine,
                &pairing_device,
                &pairing_token,
                Duration::from_secs(2),
            )
            .await,
        None,
        "the pairing device may only pair, never connect"
    );
    assert_eq!(
        phone
            .pair_relay(
                relay,
                machine,
                &pairing_device,
                &pairing_token,
                offer.secret,
                WAIT
            )
            .await,
        Some(false),
        "the pairing channel starts a fresh session"
    );

    let (device, token) = phone.paired_credentials(WAIT).await;
    assert_eq!(device, phone.identity.public().id());
    assert_ne!(device, pairing_device, "the phone gets its own device id");
    phone.disconnect().await;
    (phone, device, token)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_phone_pairs_through_the_relay_with_no_lan() {
    let relay = TestRelay::start().await;
    let daemon = TestDaemon::start(Options {
        lan: false,
        relay: Some(relay.url.clone()),
        ..Options::default()
    })
    .await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;

    let offer = daemon.offer().await;
    let machine = hex(&offer.fingerprint[..16]);
    let (mut phone, device, token) = pair(relay.addr, &machine, &offer).await;

    assert!(
        phone
            .reconnect_relay(relay.addr, &machine, &device, &token, WAIT)
            .await,
        "the paired session resumes over the relay"
    );
    assert_eq!(
        phone.echo("paired over the relay", WAIT).await.1,
        b"echo:paired over the relay"
    );
    assert!(
        !device_authorised(
            relay.addr,
            &machine,
            &pairing::device_id(&offer.secret),
            &pairing::token(&offer.secret),
        )
        .await,
        "the one-time pairing device is revoked once it has paired"
    );
    assert_eq!(
        bridge.session_count(),
        1,
        "the pairing channel never opened a second bridge socket"
    );

    daemon.stop().await;
    bridge.stop().await;
    relay.stop().await;
}
