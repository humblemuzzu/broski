mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use common::feed::FakeFeed;
use common::scenario::pair_lan_phone;

const WAIT: Duration = Duration::from_secs(15);
const HEADER: &str = "x-broski-link-key";

/// The key is minted on every start, kept private, and presented by every upgrade the daemon makes
/// to the bridge socket: the session's, the feed's and the letter pipe's.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_upgrade_to_the_bridge_carries_the_key_of_this_start() {
    let first = TestDaemon::start(Options::default()).await;
    let key_path = first.home.join("bridge.key");
    let mode = std::fs::metadata(&key_path)
        .expect("the key file exists")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600, "the key file is owner-only");
    let key = std::fs::read_to_string(&key_path).expect("read the key");
    assert_eq!(key.len(), 64, "the key is 32 bytes as hex");
    assert!(key.bytes().all(|byte| byte.is_ascii_hexdigit()));

    // A bridge that only comes up now: the feed and the session socket both dial it from here.
    let feed = FakeFeed::start(first.bridge_socket.clone()).await;
    let mut phone = pair_lan_phone(&first).await;
    phone.await_control("routes", WAIT).await;
    feed.await_feed(WAIT).await;
    let device = phone.identity.public().id();
    let deadline = tokio::time::Instant::now() + WAIT;
    while !feed
        .connections()
        .iter()
        .any(|headers| common::header(headers, "x-broski-role").as_deref() == Some("owner"))
    {
        assert!(
            tokio::time::Instant::now() < deadline,
            "the session never dialled the bridge"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!device.is_empty());

    let presented: Vec<Option<String>> = feed
        .connections()
        .iter()
        .map(|headers| common::header(headers, HEADER))
        .collect();
    assert!(
        !presented.is_empty(),
        "no upgrade reached the bridge at all"
    );
    for header in &presented {
        assert_eq!(
            header.as_deref(),
            Some(key.as_str()),
            "an upgrade arrived without this start's key"
        );
    }
    let roles: Vec<String> = feed
        .connections()
        .iter()
        .filter_map(|headers| common::header(headers, "x-broski-role"))
        .collect();
    assert!(roles.iter().any(|role| role == "link-daemon"), "{roles:?}");
    assert!(roles.iter().any(|role| role == "owner"), "{roles:?}");

    feed.stop().await;
    first.stop().await;

    // A new start mints a new key: a bridge still holding the old one refuses it.
    let second = TestDaemon::start(Options::default()).await;
    let next = std::fs::read_to_string(second.home.join("bridge.key")).expect("the new key");
    assert_ne!(key, next, "the key is minted again on every start");
    second.stop().await;
}
