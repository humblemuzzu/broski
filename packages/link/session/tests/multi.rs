mod common;

use broski_link_session::{LinkState, Paired, Route};
use broski_link_testkit::daemon::{Home, TestDaemon};
use common::bridge::BridgeStandIn;
use common::watch::Watch;
use common::{quick, Phone};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_machines_on_one_runtime_are_independent() {
    let (first_home, second_home) = (Home::new(), Home::new());
    let first = TestDaemon::start(&first_home, None, true).await;
    let second = TestDaemon::start(&second_home, None, true).await;
    let first_bridge = BridgeStandIn::start(&first_home.bridge_socket());
    let second_bridge = BridgeStandIn::start(&second_home.bridge_socket());
    let phone = Phone::new();

    let Paired {
        session,
        record: one,
    } = phone
        .pair(&first, vec![first.lan().to_string()], quick())
        .await;
    let mut a = Watch::new(session);
    let Paired {
        session,
        record: two,
    } = phone
        .pair(&second, vec![second.lan().to_string()], quick())
        .await;
    let mut b = Watch::new(session);
    assert_ne!(one.id, two.id);
    assert_eq!(
        one.device_id, two.device_id,
        "one phone identity on every machine"
    );
    a.connected_on(0, Route::Lan).await;
    b.connected_on(0, Route::Lan).await;

    a.round_trip("to the first").await;
    b.round_trip("to the second").await;
    assert_eq!(first_bridge.received(), ["to the first"]);
    assert_eq!(second_bridge.received(), ["to the second"]);

    a.session.close();
    a.end().await;
    b.round_trip("still here").await;
    assert!(matches!(
        b.session.status().state,
        LinkState::Connected { .. }
    ));
    assert_eq!(b.bridge, ["echo:to the second", "echo:still here"]);
    first_bridge.stop();
    second_bridge.stop();
    first.stop().await;
    second.stop().await;
}
