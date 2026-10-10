mod common;

use std::net::SocketAddr;
use std::time::Duration;

use broski_link_core::crypto::{HandshakeMode, Initiator, PublicBundle};
use broski_link_core::proto::{Hello, Resume, Welcome};
use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, raw_handshake, Phone};

const WAIT: Duration = Duration::from_secs(10);

/// Offers a session id this device does not own and reports the machine's answer.
async fn resume_stolen(
    addr: SocketAddr,
    phone: &Phone,
    bundle: &PublicBundle,
    stolen: [u8; 16],
) -> Welcome {
    let hello = Hello {
        resume: Some(Resume {
            session_id: stolen,
            next_expected: 0,
        }),
        caps: 0,
    };
    let (initiator, msg1) = Initiator::start(
        &phone.identity,
        bundle,
        HandshakeMode::Connect,
        &hello.encode(),
    )
    .expect("msg1");
    let msg2 = raw_handshake(addr, msg1, WAIT)
        .await
        .expect("a known device is answered");
    let (_, payload) = initiator.finish(&msg2).expect("msg2");
    Welcome::decode(&payload).expect("welcome")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_belonging_to_another_device_starts_a_fresh_one() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;

    let mut first = Phone::new(bundle.clone());
    let offer = daemon.offer().await;
    assert_eq!(first.pair_lan(addr, &offer).await, Some(false));
    assert_eq!(first.echo("first", WAIT).await.1, b"echo:first");
    let stolen = first.session_id().expect("a session exists");

    let mut second = Phone::new(bundle.clone());
    let offer = daemon.offer().await;
    assert_eq!(second.pair_lan(addr, &offer).await, Some(false));
    assert_ne!(second.session_id(), Some(stolen));
    second.disconnect().await;

    let welcome = resume_stolen(addr, &second, &bundle, stolen).await;
    assert!(
        !welcome.resumed,
        "another device's session is never resumed"
    );
    assert_ne!(welcome.session_id, stolen);

    assert_eq!(
        first.echo("still mine", WAIT).await.1,
        b"echo:still mine",
        "the first device keeps its session"
    );
    assert_eq!(first.session_id(), Some(stolen));

    daemon.stop().await;
    bridge.stop().await;
}
