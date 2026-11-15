//! The real bridge (Bun) with the contract's fake backend, on a daemon's unix socket:
//! `packages/bridge/scripts/dev-fake-bridge.ts`, driven over its stdin.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;

use broski_contract::SessionRef;
use broski_link_testkit::daemon::Home;
use broski_link_testkit::WAIT;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;
use tokio::time::timeout;

const MARK: &str = "FAKE-BRIDGE ";

fn bridge_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../bridge")
}

/// The bridge's terminals load its native PTY helper, which a checkout builds on first use.
fn ensure_pty_helper() {
    static BUILT: OnceLock<()> = OnceLock::new();
    BUILT.get_or_init(|| {
        let script = "import { ensureNativePtyLibrary } from \"./src/__tests__/helpers/native-pty-library\"; ensureNativePtyLibrary();";
        let status = std::process::Command::new("bun")
            .args(["-e", script])
            .current_dir(bridge_dir())
            .status()
            .expect("bun runs");
        assert!(status.success(), "the PTY helper builds");
    });
}

pub struct FakeBridge {
    _child: Child,
    stdin: ChildStdin,
    lines: mpsc::UnboundedReceiver<Value>,
    next: u64,
}

impl FakeBridge {
    /// Serves `home`'s bridge socket with `root` as its home and the one directory it may touch.
    pub async fn start(home: &Home, root: &Path) -> FakeBridge {
        ensure_pty_helper();
        let mut child = Command::new("bun")
            .arg("scripts/dev-fake-bridge.ts")
            .arg("--link-socket")
            .arg(home.bridge_socket())
            .arg("--link-key-file")
            .arg(home.path.join("bridge.key"))
            .current_dir(bridge_dir())
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("TMPDIR", std::env::temp_dir())
            .env("HOME", root)
            .env("SHELL", "/bin/sh")
            .env("BROSKI_ALLOWED_BASE_PATHS", root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("bun starts the fake bridge");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let (sender, lines) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(json) = line.strip_prefix(MARK) {
                    let _ = sender.send(serde_json::from_str(json).expect("a json line"));
                }
            }
        });
        let mut bridge = FakeBridge {
            _child: child,
            stdin,
            lines,
            next: 0,
        };
        bridge
            .line_where("the bridge to start", |line| line["ready"] == true)
            .await;
        bridge
    }

    async fn line_where(&mut self, what: &str, matches: impl Fn(&Value) -> bool) -> Value {
        loop {
            match timeout(WAIT, self.lines.recv()).await {
                Ok(Some(line)) if matches(&line) => return line,
                Ok(Some(_)) => {}
                Ok(None) => panic!("the fake bridge exited while waiting for {what}"),
                Err(_) => panic!("timed out waiting for {what}"),
            }
        }
    }

    async fn command(&mut self, mut command: Value) -> Value {
        self.next += 1;
        let id = self.next;
        command["id"] = json!(id);
        let line = format!("{command}\n");
        self.stdin.write_all(line.as_bytes()).await.expect("stdin");
        let answer = self
            .line_where("a command's answer", |line| line["id"] == id)
            .await;
        assert!(answer.get("error").is_none(), "{command}: {answer}");
        answer
    }

    /// A session with one finished exchange in its history.
    pub async fn seed(&mut self, cwd: &Path, title: &str) -> SessionRef {
        let answer = self
            .command(json!({"cmd": "seed", "cwd": cwd, "title": title}))
            .await;
        serde_json::from_value(answer["session"].clone()).expect("a session ref")
    }

    /// What the session's next run does: `ask`, `hold`, `replace`, `permission` or `work`.
    pub async fn script(&mut self, session: &SessionRef, scenario: &str) {
        self.command(json!({"cmd": "script", "session": session, "scenario": scenario}))
            .await;
    }

    /// Ends the hold the session's run waits in.
    pub async fn release(&mut self, session: &SessionRef) {
        self.command(json!({"cmd": "release", "session": session}))
            .await;
    }

    /// The bridge restarts in place: new streams, the same sessions, every run ended.
    pub async fn restart(&mut self) {
        self.command(json!({"cmd": "restart"})).await;
    }
}
