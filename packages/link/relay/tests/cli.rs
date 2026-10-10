mod common;

use std::net::SocketAddr;
use std::process::Stdio;
use std::time::Duration;

use common::{bundle_of, connect_machine, http_get, machine_id, try_http_get};
use tokio::net::TcpListener;

fn relay_binary() -> &'static str {
    env!("CARGO_BIN_EXE_broski-relay")
}

async fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    listener.local_addr().expect("local addr").port()
}

async fn wait_until_serving(addr: SocketAddr) {
    for _ in 0..200 {
        if let Some((200, _)) = try_http_get(addr, "/healthz", &[]).await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("relay never answered /healthz");
}

#[cfg(unix)]
#[tokio::test]
async fn cli_serves_and_stops_on_sigterm() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db = dir.path().join("relay.db");
    let port = free_port().await;
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().expect("addr");
    let mut child = tokio::process::Command::new(relay_binary())
        .args([
            "--listen",
            &addr.to_string(),
            "--db",
            db.to_str().expect("db path"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn relay");

    wait_until_serving(addr).await;
    assert_eq!(http_get(addr, "/healthz", &[]).await.1, "ok");

    let bundle = bundle_of(60);
    let id = machine_id(&bundle);
    let mut machine = connect_machine(addr, &id, "secret")
        .await
        .expect("machine connects to the spawned relay");
    assert_eq!(machine.publish(&bundle).await["t"], "ok");
    assert_eq!(
        http_get(addr, &format!("/v1/identity/{id}"), &[]).await.0,
        200
    );

    let pid = child.id().expect("child pid");
    let killed = tokio::process::Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .await
        .expect("send SIGTERM");
    assert!(killed.success());

    assert_eq!(machine.close().await.0, 1012);
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .expect("relay exits after SIGTERM")
        .expect("wait");
    assert!(status.success(), "relay exited with {status}");
}

#[tokio::test]
async fn cli_requires_a_database_path() {
    let output = tokio::process::Command::new(relay_binary())
        .args(["--listen", "127.0.0.1:0"])
        .output()
        .await
        .expect("run relay");
    assert!(!output.status.success());
}
