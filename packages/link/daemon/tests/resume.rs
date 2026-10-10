mod common;

use std::time::Duration;

use common::bridge::FakeBridge;
use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};

const WAIT: Duration = Duration::from_secs(20);
const ROUNDS: usize = 5;
const PER_ROUND: usize = 100;

fn payload(index: usize) -> String {
    format!("m{index:04}")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn five_drops_keep_every_message_and_one_bridge_socket() {
    let daemon = TestDaemon::start(Options::default()).await;
    let bridge = FakeBridge::start(daemon.bridge_socket.clone()).await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;

    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));

    for round in 0..ROUNDS {
        let base = round * PER_ROUND;
        for index in base..base + PER_ROUND {
            phone.send(1, payload(index).as_bytes()).await;
        }
        phone.disconnect().await;
        assert_eq!(
            phone.connect_lan(addr, WAIT).await,
            Some(true),
            "round {round} resumed"
        );
        for index in base..base + PER_ROUND {
            let (stream, bytes) = phone.next_message(WAIT).await;
            assert_eq!(stream, 1);
            assert_eq!(
                String::from_utf8(bytes).expect("utf8"),
                format!("echo:{}", payload(index)),
                "round {round} message {index}"
            );
        }
    }

    assert_eq!(phone.resumed, [false, true, true, true, true, true]);
    assert_eq!(
        bridge.session_count(),
        1,
        "the bridge never noticed the five network switches"
    );
    assert_eq!(bridge.received().len(), ROUNDS * PER_ROUND);

    daemon.stop().await;
    bridge.stop().await;
}
