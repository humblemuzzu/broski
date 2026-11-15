use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use broski_link_core::crypto::PairingOffer;
use broski_link_daemon::durations::Durations;
use broski_link_daemon::{run, Handle, RunOptions};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

/// A private daemon home that outlives one daemon, so a test can restart the machine on it.
pub struct Home {
    _dir: TempDir,
    pub path: PathBuf,
}

impl Home {
    pub fn new() -> Home {
        let dir = tempfile::tempdir().expect("temp home");
        let path = dir.path().join("link");
        Home { _dir: dir, path }
    }

    pub fn bridge_socket(&self) -> PathBuf {
        self.path.join("bridge.sock")
    }
}

/// The real daemon, in-process, on a private home, never advertised on the network and never
/// handing the phone the addresses of the network it runs on.
pub struct TestDaemon {
    pub lan: Option<SocketAddr>,
    handle: Handle,
}

impl TestDaemon {
    pub async fn start(home: &Home, relay: Option<&str>, lan: bool) -> TestDaemon {
        let handle = run(RunOptions {
            home: home.path.clone(),
            relay: relay.map(str::to_owned),
            lan_port: 0,
            lan,
            bridge_socket: home.bridge_socket(),
            bridge_cmd: None,
            advertise: false,
            scan_interfaces: false,
            durations: Durations::default(),
        })
        .await
        .expect("the daemon starts");
        let lan = handle
            .lan_port
            .map(|port| SocketAddr::from(([127, 0, 0, 1], port)));
        TestDaemon { lan, handle }
    }

    pub fn lan(&self) -> SocketAddr {
        self.lan.expect("the daemon listens on the lan")
    }

    pub async fn ask(&self, request: Value) -> Value {
        ask(&self.handle.control_path(), request).await
    }

    pub async fn offer(&self) -> PairingOffer {
        let reply = self.ask(json!({"cmd": "pair"})).await;
        PairingOffer::parse(reply["uri"].as_str().expect("pair uri")).expect("a valid offer")
    }

    /// Whether the daemon holds a session for `device` and whether a connection is attached to it.
    pub async fn session_attached(&self, device: &str) -> Option<bool> {
        let status = self.ask(json!({"cmd": "status"})).await;
        status["sessions"]
            .as_array()?
            .iter()
            .find(|session| session["device"] == device[..8])
            .map(|session| session["connected"] == true)
    }

    pub async fn stop(self) {
        self.handle.stop().await;
    }
}

async fn ask(path: &Path, request: Value) -> Value {
    let mut stream = UnixStream::connect(path).await.expect("control socket");
    stream
        .write_all(format!("{request}\n").as_bytes())
        .await
        .expect("write the request");
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .await
        .expect("read the reply");
    serde_json::from_str(&line).expect("the reply is json")
}
