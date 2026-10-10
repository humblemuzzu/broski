use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_relay::push::config::{self, ApnsArgs, PushArgs};
use broski_relay::push::PushConfig;
use serde_json::Value;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub const APNS_KEY_ID: &str = "TESTKEYID1";
pub const APNS_TEAM_ID: &str = "TESTTEAM99";
pub const APNS_TOPIC: &str = "dev.broski.link.test";

/// A throwaway P-256 key that signs only against the mock in these tests; the same public test key
/// the relay's own provider tests carry.
const APNS_KEY_PEM: &str = r"-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgaFCg4NKtr+iTZnui
7zIFwpjatAAIOQUjy534/HXcbp+hRANCAARmJVVNN93QKKBg2C4m4M4XszFKpvaW
iiPgiYdzrsCEruEV7OG/5dEujEnmozBNKMEqbNS9EB+wiVRd5FUKO6X4
-----END PRIVATE KEY-----
";

/// One push the relay handed to the mock.
#[derive(Clone)]
pub struct Sent {
    pub token: String,
    headers: HeaderMap,
    body: Value,
}

impl Sent {
    pub fn header(&self, name: &str) -> String {
        self.headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    }

    pub fn body(&self) -> &Value {
        &self.body
    }

    /// The opaque `e` field, decoded.
    pub fn data(&self) -> Vec<u8> {
        let text = self.body["e"].as_str().expect("e is a b64url string");
        URL_SAFE_NO_PAD.decode(text).expect("e is b64url")
    }
}

#[derive(Clone, Default)]
pub struct Received {
    entries: Arc<Mutex<Vec<Sent>>>,
}

impl Received {
    fn push(&self, sent: Sent) {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(sent);
    }

    pub fn all(&self) -> Vec<Sent> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn count(&self) -> usize {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .len()
    }

    pub async fn wait(&self, count: usize, budget: Duration) -> Vec<Sent> {
        let deadline = tokio::time::Instant::now() + budget;
        while self.count() < count {
            assert!(
                tokio::time::Instant::now() < deadline,
                "only {} pushes arrived, expected {count}",
                self.count()
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        self.all()
    }

    /// Waits out `within` and reports the count, so a push that was not sent cannot arrive late.
    pub async fn quiet(&self, within: Duration) -> usize {
        tokio::time::sleep(within).await;
        self.count()
    }
}

/// A local APNs: HTTP/2, one request per push, everything recorded.
pub struct ApnsMock {
    dir: TempDir,
    pub base: String,
    pub sent: Received,
    task: JoinHandle<()>,
}

impl ApnsMock {
    pub async fn start() -> ApnsMock {
        let sent = Received::default();
        let app = Router::new()
            .route("/3/device/{token}", post(send))
            .with_state(sent.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind APNs");
        let addr = listener.local_addr().expect("APNs addr");
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        ApnsMock {
            dir: tempfile::tempdir().expect("APNs key dir"),
            base: format!("http://{addr}"),
            sent,
            task,
        }
    }

    /// The relay configuration that sends everything to this mock, keyed by a throwaway .p8.
    pub async fn push_config(&self) -> PushConfig {
        let key = self.dir.path().join("apns.p8");
        tokio::fs::write(&key, APNS_KEY_PEM)
            .await
            .expect("write the APNs key");
        let args = PushArgs {
            apns: Some(ApnsArgs {
                key,
                key_id: APNS_KEY_ID.to_owned(),
                team_id: APNS_TEAM_ID.to_owned(),
                topic: APNS_TOPIC.to_owned(),
                sandbox: false,
            }),
            apns_endpoint: Some(self.base.clone()),
            ..PushArgs::default()
        };
        config::load(args).await.expect("APNs push config")
    }
}

impl Drop for ApnsMock {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn send(
    State(sent): State<Received>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    sent.push(Sent {
        token,
        headers,
        body: serde_json::from_slice(&body).unwrap_or(Value::Null),
    });
    StatusCode::OK.into_response()
}
