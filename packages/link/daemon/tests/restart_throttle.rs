mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;
use serde_json::json;

const WAIT: Duration = Duration::from_secs(10);
const STORM: usize = 8;
const SETTLE: Duration = Duration::from_millis(400);

/// A phone that sends `bridge_restart` as fast as it can must not respawn the bridge as fast as it
/// can: the supervisor is debounced, and a restart counts against its backoff.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_restart_storm_cannot_respawn_the_bridge_over_and_over() {
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
    let mut phone = pair_lan_phone(&daemon).await;
    let runs = |log: &std::path::Path| {
        std::fs::read_to_string(log)
            .map(|text| text.lines().count())
            .unwrap_or(0)
    };
    let deadline = Instant::now() + WAIT;
    while runs(&log) < 1 {
        assert!(Instant::now() < deadline, "the bridge never started");
        phone.step().await;
    }

    for _ in 0..STORM {
        phone.send_control(json!({"t": "bridge_restart"})).await;
    }
    tokio::time::sleep(SETTLE).await;
    let started = runs(&log);
    assert_eq!(started, 1, "the storm respawned the bridge {started} times");

    // The link still works and the supervisor is not stuck: one restart is honoured, later.
    let deadline = Instant::now() + WAIT;
    while runs(&log) < 2 {
        assert!(
            Instant::now() < deadline,
            "a restart was never honoured after the storm"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    daemon.stop().await;
}
