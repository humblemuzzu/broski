mod common;

use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use common::daemon::{Options, TestDaemon};
use common::phone::{fetch_bundle, Phone};
use serde_json::Value;
use tokio_tungstenite::tungstenite::{accept, Message};

/// The daemon's own backoff is a second before it spawns again, and the child binds in well under
/// that: a state reported later than this means the daemon was waiting on something else.
const CRASH_REPORT_BUDGET: Duration = Duration::from_secs(2);
const RECOVERY_BUDGET: Duration = Duration::from_secs(20);

/// Where the supervised child says which process it is.
fn socket_pidfile(socket: &Path) -> PathBuf {
    socket.with_extension("pid")
}

/// The supervised bridge as a real child process: this test binary, run for its one ignored test.
///
/// The daemon appends `--link-socket <path>` to whatever it is given, and libtest refuses an option
/// it does not know, so a shell wrapper drops those two arguments and hands the path on from `$2`.
fn child_command() -> Vec<String> {
    let exe = std::env::current_exe().expect("the test binary's own path");
    let script = format!(
        "BROSKI_TEST_BRIDGE_SOCKET=\"$2\" exec \"{}\" --exact --ignored bridge_child",
        exe.display()
    );
    vec![
        "/bin/sh".to_owned(),
        "-c".to_owned(),
        script,
        "sh".to_owned(),
    ]
}

/// The child half. It writes its pid, then serves the bridge socket until it is SIGKILLed.
#[test]
#[ignore = "spawned by a_killed_bridge_process, never run on its own"]
fn bridge_child() {
    let socket = PathBuf::from(
        std::env::var("BROSKI_TEST_BRIDGE_SOCKET").expect("the wrapper passes the socket path"),
    );
    std::fs::write(socket_pidfile(&socket), std::process::id().to_string()).expect("pid file");
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).expect("bind the bridge socket");
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        std::thread::spawn(move || answer(stream));
    }
}

/// What the daemon needs from a bridge for this test: a feed pong, and a request echoed back.
fn answer(stream: UnixStream) {
    let Ok(mut socket) = accept(stream) else {
        return;
    };
    loop {
        let text = match socket.read() {
            Ok(Message::Text(text)) => text.as_str().to_owned(),
            Ok(Message::Binary(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
            Ok(Message::Close(_)) | Err(_) => return,
            Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_)) => continue,
        };
        let reply = if text.contains("link_feed_ping") {
            "{\"type\":\"link_feed_pong\"}".to_owned()
        } else {
            format!("echo:{text}")
        };
        if socket.send(Message::Text(reply.into())).is_err() {
            return;
        }
    }
}

/// SIGKILLs the process the supervised bridge wrote its pid with, and reports that pid.
async fn kill_bridge(socket: &Path) -> u32 {
    let pidfile = socket_pidfile(socket);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(text) = std::fs::read_to_string(&pidfile) {
            if let Ok(pid) = text.trim().parse::<u32>() {
                let status = Command::new("kill")
                    .arg("-9")
                    .arg(pid.to_string())
                    .status()
                    .expect("kill the supervised bridge");
                assert!(status.success(), "kill -9 {pid} failed");
                return pid;
            }
        }
        assert!(
            Instant::now() < deadline,
            "the supervised bridge never wrote its pid to {}",
            pidfile.display()
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Every `bridge` control message the phone saw from `from` on, with the moment it saw it, up to
/// and including the first one `done` accepts.
async fn bridge_states_until(
    phone: &mut Phone,
    from: usize,
    budget: Duration,
    done: impl Fn(&Value) -> bool,
) -> Vec<(Instant, Value)> {
    let deadline = Instant::now() + budget;
    let mut seen: Vec<(Instant, Value)> = Vec::new();
    let mut index = from;
    loop {
        while index < phone.control.len() {
            let message = phone.control[index].clone();
            index += 1;
            if message["t"] != "bridge" {
                continue;
            }
            let matched = done(&message);
            seen.push((Instant::now(), message));
            if matched {
                return seen;
            }
        }
        assert!(
            Instant::now() < deadline,
            "the phone never reported the bridge back up; it saw {seen:?}"
        );
        phone.step().await;
    }
}

fn conn_of(message: &Value) -> u64 {
    message["conn"].as_u64().unwrap_or_default()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_killed_bridge_is_reported_crashed_then_starting_then_up_again() {
    let daemon = TestDaemon::start(Options {
        bridge_cmd: Some(child_command()),
        ..Options::default()
    })
    .await;
    let addr = daemon.lan();
    let bundle = fetch_bundle(addr).await;
    let offer = daemon.offer().await;
    let mut phone = Phone::new(bundle);
    assert_eq!(phone.pair_lan(addr, &offer).await, Some(false));

    let up = phone
        .bridge_messages(RECOVERY_BUDGET, |message| message["state"] == "up")
        .await;
    let conn = up.last().map(conn_of).expect("a bridge status");
    assert!(conn >= 1, "the session's socket never came up: {up:?}");
    let from = phone.control.len();

    let killed_at = Instant::now();
    let killed = kill_bridge(&daemon.bridge_socket).await;
    let states = bridge_states_until(&mut phone, from, RECOVERY_BUDGET, |message| {
        message["state"] == "up" && conn_of(message) > conn
    })
    .await;

    let crashed = states
        .iter()
        .position(|(_, message)| message["state"] == "crashed")
        .unwrap_or_else(|| {
            panic!("the phone never saw the crash, only {states:?}");
        });
    let (seen_at, message) = &states[crashed];
    assert!(
        seen_at.duration_since(killed_at) < CRASH_REPORT_BUDGET,
        "the crash reached the phone {:?} after the kill, not under {CRASH_REPORT_BUDGET:?}",
        seen_at.duration_since(killed_at)
    );
    assert!(
        message["detail"]
            .as_str()
            .is_some_and(|d| !d.trim().is_empty()),
        "a crash has to carry the supervisor's reason: {message}"
    );

    let after = &states[crashed + 1..];
    let starting = after
        .iter()
        .position(|(_, message)| message["state"] == "starting")
        .unwrap_or_else(|| panic!("no starting after the crash: {states:?}"));
    let recovered = &after[starting..];
    let (_, up_again) = recovered
        .iter()
        .find(|(_, message)| message["state"] == "up" && conn_of(message) > conn)
        .unwrap_or_else(|| panic!("the phone never saw a new bridge socket: {states:?}"));
    assert_eq!(
        conn_of(up_again),
        conn + 1,
        "one crash is one new socket for the session"
    );

    let restarted = std::fs::read_to_string(socket_pidfile(&daemon.bridge_socket))
        .expect("the restarted bridge writes its pid")
        .trim()
        .to_owned();
    assert_ne!(
        restarted,
        killed.to_string(),
        "the same process cannot have been restarted"
    );

    daemon.stop().await;
}
