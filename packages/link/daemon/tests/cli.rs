mod common;

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_broski-link");
const WAIT: Duration = Duration::from_secs(20);

async fn cli(home: &Path, args: &[&str]) -> (bool, String) {
    let output = Command::new(BIN)
        .args(args)
        .arg("--home")
        .arg(home)
        .output()
        .await
        .expect("the broski-link binary runs");
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    (output.status.success(), text)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_cli_drives_a_running_daemon() {
    let dir = tempfile::tempdir().expect("temp dir");
    let home = dir.path().join("link");
    let mut daemon = Command::new(BIN)
        .args(["run", "--no-lan", "--home"])
        .arg(&home)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn the daemon");

    let control = home.join("control.sock");
    let deadline = Instant::now() + WAIT;
    while !control.exists() {
        assert!(
            Instant::now() < deadline,
            "the daemon never created {}",
            control.display()
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let (ok, pair) = cli(&home, &["pair"]).await;
    assert!(ok, "{pair}");
    assert!(pair.contains("broski://pair?v=2&"), "{pair}");
    assert!(pair.contains("valid for "), "{pair}");

    let (ok, status) = cli(&home, &["status", "--json"]).await;
    assert!(ok, "{status}");
    let value: Value = serde_json::from_str(status.trim()).expect("status json");
    assert_eq!(value["relay_connected"], false);
    assert_eq!(value["bridge"]["state"], "down");
    assert_eq!(value["sessions"], serde_json::json!([]));
    assert_eq!(
        value["machine"]["id"].as_str().expect("machine id").len(),
        32
    );

    let (ok, devices) = cli(&home, &["devices"]).await;
    assert!(ok, "{devices}");
    assert!(devices.contains("no paired devices"), "{devices}");

    let (ok, missing) = cli(dir.path(), &["status"]).await;
    assert!(!ok);
    assert!(missing.contains("not running"), "{missing}");

    let _ = daemon.kill().await;
}
