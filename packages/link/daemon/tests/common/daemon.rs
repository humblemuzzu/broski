use std::net::SocketAddr;
use std::path::PathBuf;

use broski_link_core::crypto::PairingOffer;
use broski_link_daemon::{run, Handle, RunOptions};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

pub struct Options {
    pub lan: bool,
    pub relay: Option<String>,
    pub bridge_socket: Option<PathBuf>,
    pub bridge_cmd: Option<Vec<String>>,
    pub seed: Option<Vec<u8>>,
    pub durations: broski_link_daemon::durations::Durations,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            lan: true,
            relay: None,
            bridge_socket: None,
            bridge_cmd: None,
            seed: None,
            durations: broski_link_daemon::durations::Durations::default(),
        }
    }
}

/// The daemon running in-process on a private home, reachable through its real socket.
pub struct TestDaemon {
    pub home: PathBuf,
    pub bridge_socket: PathBuf,
    pub lan: Option<SocketAddr>,
    handle: Option<Handle>,
    temp: TempDir,
}

impl TestDaemon {
    pub async fn start(options: Options) -> TestDaemon {
        super::init_logs();
        let temp = tempfile::tempdir().expect("temp home");
        let home = temp.path().join("link");
        let bridge_socket = options
            .bridge_socket
            .unwrap_or_else(|| home.join("bridge.sock"));
        let handle = run(RunOptions {
            home: home.clone(),
            relay: options.relay,
            lan_port: 0,
            lan: options.lan,
            bridge_socket: bridge_socket.clone(),
            bridge_cmd: options.bridge_cmd,
            durations: options.durations,
        })
        .await
        .expect("the daemon starts");
        let lan = handle
            .lan_port
            .map(|port| SocketAddr::from(([127, 0, 0, 1], port)));
        TestDaemon {
            home,
            bridge_socket,
            lan,
            handle: Some(handle),
            temp,
        }
    }

    pub fn lan(&self) -> SocketAddr {
        self.lan.expect("the daemon is listening on the lan")
    }

    pub fn control_path(&self) -> PathBuf {
        self.handle.as_ref().expect("running").control_path()
    }

    pub async fn ask(&self, request: Value) -> Value {
        let path = self.control_path();
        let mut stream = UnixStream::connect(&path).await.expect("control socket");
        let mut line = String::new();
        stream
            .write_all(format!("{request}\n").as_bytes())
            .await
            .expect("write request");
        BufReader::new(stream)
            .read_line(&mut line)
            .await
            .expect("read reply");
        serde_json::from_str(&line).expect("reply is json")
    }

    pub async fn offer(&self) -> PairingOffer {
        let reply = self.ask(json!({"cmd": "pair"})).await;
        let uri = reply["uri"].as_str().expect("pair uri");
        PairingOffer::parse(uri).expect("the daemon builds a valid offer")
    }

    pub async fn stop(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.stop().await;
        }
        drop(self.temp);
    }
}
