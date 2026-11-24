mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use broski_link_daemon::{run, RunOptions};
use common::daemon::{Options, TestDaemon};
use common::scenario::pair_lan_phone;

const WAIT: Duration = Duration::from_secs(15);

fn options(home: &Path, bridge_socket: PathBuf) -> RunOptions {
    RunOptions {
        home: home.to_path_buf(),
        relay: None,
        relay_register_token: None,
        lan_port: 0,
        lan: true,
        bridge_socket,
        bridge_cmd: None,
        advertise: false,
        scan_interfaces: false,
        screen_port: 5900,
        watch_dialogs: false,
        durations: broski_link_daemon::durations::Durations::default(),
    }
}

/// A crash between the write of a state file and its rename leaves a temporary file behind; the
/// state the daemon had before it is still the state it starts from.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_half_written_state_file_is_ignored_on_the_next_start() {
    let dir = tempfile::tempdir().expect("temp home");
    let home = dir.path().join("link");
    std::fs::create_dir_all(&home).expect("home");
    std::fs::write(home.join("devices.json.tmp"), b"[{\"id\":\"half").expect("the crashed write");

    let daemon = TestDaemon::start(Options::default()).await;
    // Whatever the daemon had is what it starts from, and the leftover is not it.
    let mut phone = pair_lan_phone(&daemon).await;
    phone.await_control("routes", WAIT).await;
    let devices = std::fs::read(daemon.home.join("devices.json")).expect("devices.json");
    let parsed: serde_json::Value = serde_json::from_slice(&devices).expect("devices.json is json");
    assert_eq!(parsed.as_array().map(Vec::len), Some(1));
    daemon.stop().await;
}

/// A device list that cannot be read is moved aside and the daemon starts with none, instead of
/// refusing to run for good.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_corrupt_device_list_does_not_keep_the_daemon_from_starting() {
    let dir = tempfile::tempdir().expect("temp home");
    let home = dir.path().join("link");
    std::fs::create_dir_all(&home).expect("home");
    std::fs::write(home.join("devices.json"), b"not json at all").expect("a corrupt file");

    let handle = run(options(&home, home.join("bridge.sock")))
        .await
        .expect("the daemon starts on a corrupt device list");
    let aside: Vec<PathBuf> = std::fs::read_dir(&home)
        .expect("list the home")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.to_string_lossy().contains(".corrupt-"))
        .collect();
    assert_eq!(aside.len(), 1, "the unreadable list is kept aside");
    handle.stop().await;
}

/// The identity is the one file that is never regenerated: doing that would unpair every device,
/// so the daemon refuses to start and names the file.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_corrupt_identity_refuses_to_start_and_names_the_file() {
    let dir = tempfile::tempdir().expect("temp home");
    let home = dir.path().join("link");
    std::fs::create_dir_all(&home).expect("home");
    std::fs::write(home.join("identity"), b"short").expect("a truncated identity");

    let error = run(options(&home, home.join("bridge.sock")))
        .await
        .err()
        .expect("the daemon refuses to start");
    let message = error.to_string();
    assert!(
        message.contains("identity"),
        "the error does not name the file: {message}"
    );
    assert!(
        message.contains("pair every device again") || message.contains("Restore"),
        "the error is not actionable: {message}"
    );
    assert_eq!(
        std::fs::read(home.join("identity")).expect("the file is untouched"),
        b"short",
        "a refuse is not a rewrite"
    );
}
