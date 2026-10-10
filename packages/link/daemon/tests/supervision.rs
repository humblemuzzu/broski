mod common;

use std::collections::HashSet;
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_crashing_bridge_is_restarted_and_reported() {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = dir.path().join("runs.log");
    let script = dir.path().join("bridge.sh");
    std::fs::write(
        &script,
        format!("#!/bin/sh\necho \"$@\" >> {}\nsleep 1\n", log.display()),
    )
    .expect("write the supervised bridge");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    let daemon = TestDaemon::start(Options {
        bridge_cmd: Some(vec!["/bin/sh".to_owned(), script.display().to_string()]),
        ..Options::default()
    })
    .await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));

    let mut states: HashSet<String> = HashSet::new();
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        for message in phone.control.drain(..) {
            if message["t"] == "bridge" {
                states.insert(message["state"].as_str().unwrap_or_default().to_owned());
            }
        }
        phone.step().await;
    }

    assert!(states.contains("starting"), "states seen: {states:?}");
    assert!(states.contains("crashed"), "states seen: {states:?}");
    let runs: Vec<String> = std::fs::read_to_string(&log)
        .expect("the supervised bridge ran")
        .lines()
        .map(str::to_owned)
        .collect();
    assert!(runs.len() >= 2, "the bridge was not restarted: {runs:?}");
    assert_eq!(
        runs[0],
        format!("--link-socket {}", daemon.bridge_socket.display())
    );

    daemon.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_restart_request_is_honoured() {
    let dir = tempfile::tempdir().expect("temp dir");
    let log = dir.path().join("runs.log");
    let script = dir.path().join("bridge.sh");
    std::fs::write(
        &script,
        format!("#!/bin/sh\necho run >> {}\nsleep 30\n", log.display()),
    )
    .expect("write the supervised bridge");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).expect("chmod");

    let daemon = TestDaemon::start(Options {
        bridge_cmd: Some(vec!["/bin/sh".to_owned(), script.display().to_string()]),
        ..Options::default()
    })
    .await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));

    let deadline = Instant::now() + Duration::from_secs(10);
    while std::fs::read_to_string(&log).map_or(0, |text| text.lines().count()) < 1 {
        assert!(Instant::now() < deadline, "the bridge never started");
        phone.step().await;
    }

    phone
        .send_control(serde_json::json!({"t": "bridge_restart"}))
        .await;
    let deadline = Instant::now() + Duration::from_secs(10);
    while std::fs::read_to_string(&log).map_or(0, |text| text.lines().count()) < 2 {
        assert!(Instant::now() < deadline, "the bridge was not restarted");
        phone.step().await;
    }

    daemon.stop().await;
}
