use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use broski_relay::push::config::{self, ApnsArgs, PushArgs};
use broski_relay::push::PushConfig;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use super::keys::{TEST_APNS_KEY_PEM, TEST_FCM_KEY_PEM};
use super::{APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, FCM_CLIENT_EMAIL, FCM_PROJECT};

const ACCESS_TOKEN: &str = "mock-access-token";

#[derive(Clone, Debug)]
pub struct Captured {
    pub path: String,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Captured {
    pub fn header(&self, name: &str) -> String {
        self.headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    }

    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).expect("json body")
    }
}

#[derive(Clone, Default)]
pub struct Recorder {
    entries: Arc<Mutex<Vec<Captured>>>,
}

impl Recorder {
    fn record(&self, entry: Captured) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(entry);
    }

    pub fn all(&self) -> Vec<Captured> {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn count(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub async fn wait(&self, count: usize) -> Vec<Captured> {
        for _ in 0..500 {
            if self.count() >= count {
                return self.all();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "only {} mock requests arrived, expected {count}",
            self.count()
        );
    }

    pub async fn quiet(&self, within: Duration) {
        let before = self.count();
        tokio::time::sleep(within).await;
        assert_eq!(self.count(), before, "the provider was called again");
    }
}

#[derive(Clone)]
struct Fault {
    status: Arc<AtomicU16>,
    body: Arc<Mutex<String>>,
    delay: Arc<AtomicU16>,
}

impl Fault {
    fn new() -> Fault {
        Fault {
            status: Arc::new(AtomicU16::new(200)),
            body: Arc::new(Mutex::new(String::new())),
            delay: Arc::new(AtomicU16::new(0)),
        }
    }

    fn set(&self, status: u16, body: &str) {
        self.status.store(status, Ordering::Relaxed);
        *self.body.lock().unwrap_or_else(|e| e.into_inner()) = body.to_owned();
    }

    fn slow(&self, millis: u64) {
        self.delay.store(millis as u16, Ordering::Relaxed);
    }

    async fn wait(&self) {
        let millis = self.delay.load(Ordering::Relaxed);
        if millis > 0 {
            tokio::time::sleep(Duration::from_millis(millis as u64)).await;
        }
    }

    fn response(&self) -> Response {
        let code = StatusCode::from_u16(self.status.load(Ordering::Relaxed))
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = self.body.lock().unwrap_or_else(|e| e.into_inner()).clone();
        (code, body).into_response()
    }
}

pub struct ApnsMock {
    pub base: String,
    pub requests: Recorder,
    fault: Fault,
    task: JoinHandle<()>,
}

impl ApnsMock {
    pub async fn start() -> ApnsMock {
        let requests = Recorder::default();
        let fault = Fault::new();
        let state = (requests.clone(), fault.clone());
        let app = Router::new()
            .route("/3/device/{token}", post(apns_send))
            .with_state(state);
        let (base, task) = serve(app).await;
        ApnsMock {
            base,
            requests,
            fault,
            task,
        }
    }

    pub fn reject(&self, status: u16, body: &str) {
        self.fault.set(status, body);
    }

    pub fn slow(&self, millis: u64) {
        self.fault.slow(millis);
    }
}

impl Drop for ApnsMock {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn apns_send(
    State((requests, fault)): State<(Recorder, Fault)>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    requests.record(Captured {
        path: format!("/3/device/{token}"),
        headers,
        body: body.to_vec(),
    });
    fault.wait().await;
    fault.response()
}

pub struct FcmMock {
    pub base: String,
    pub requests: Recorder,
    pub token_requests: Recorder,
    fault: Fault,
    task: JoinHandle<()>,
}

impl FcmMock {
    pub async fn start() -> FcmMock {
        let requests = Recorder::default();
        let token_requests = Recorder::default();
        let fault = Fault::new();
        let send_state = (requests.clone(), fault.clone());
        let token_state = token_requests.clone();
        let app = Router::new()
            .route("/v1/projects/{project}/messages:send", post(fcm_send))
            .with_state(send_state)
            .route("/token", post(fcm_token))
            .with_state(token_state);
        let (base, task) = serve(app).await;
        FcmMock {
            base,
            requests,
            token_requests,
            fault,
            task,
        }
    }

    pub fn reject(&self, status: u16, body: &str) {
        self.fault.set(status, body);
    }
}

impl Drop for FcmMock {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn fcm_send(
    State((requests, fault)): State<(Recorder, Fault)>,
    Path(project): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    requests.record(Captured {
        path: format!("/v1/projects/{project}/messages:send"),
        headers,
        body: body.to_vec(),
    });
    fault.response()
}

async fn fcm_token(State(requests): State<Recorder>, body: Bytes) -> Response {
    requests.record(Captured {
        path: "/token".to_owned(),
        headers: HeaderMap::new(),
        body: body.to_vec(),
    });
    let token = json!({
        "access_token": ACCESS_TOKEN,
        "expires_in": 3600,
        "token_type": "Bearer",
    });
    (StatusCode::OK, axum::Json(token)).into_response()
}

async fn serve(app: Router) -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let addr = listener.local_addr().expect("mock addr");
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (format!("http://{addr}"), task)
}

pub struct Providers {
    pub apns: ApnsMock,
    pub fcm: FcmMock,
    pub config: PushConfig,
}

pub async fn providers() -> Providers {
    let apns = ApnsMock::start().await;
    let fcm = FcmMock::start().await;
    let mut config = apns_push_config(&apns.base).await;
    config.fcm = fcm_push_config(&fcm.base, &format!("{}/token", fcm.base))
        .await
        .fcm;
    Providers { apns, fcm, config }
}

pub async fn apns_push_config(endpoint: &str) -> PushConfig {
    let dir = tempfile::tempdir().expect("temp dir");
    let key = dir.path().join("apns.p8");
    tokio::fs::write(&key, TEST_APNS_KEY_PEM)
        .await
        .expect("write apns key");
    let args = PushArgs {
        apns: Some(ApnsArgs {
            key,
            key_id: APNS_KEY_ID.to_owned(),
            team_id: APNS_TEAM_ID.to_owned(),
            topic: APNS_TOPIC.to_owned(),
            sandbox: false,
        }),
        apns_endpoint: Some(endpoint.to_owned()),
        ..PushArgs::default()
    };
    config::load(args).await.expect("apns push config")
}

pub async fn fcm_push_config(endpoint: &str, token_endpoint: &str) -> PushConfig {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("service-account.json");
    let account = json!({
        "type": "service_account",
        "project_id": FCM_PROJECT,
        "private_key_id": "test-key",
        "private_key": TEST_FCM_KEY_PEM,
        "client_email": FCM_CLIENT_EMAIL,
        "token_uri": token_endpoint,
    });
    tokio::fs::write(&path, account.to_string())
        .await
        .expect("write service account");
    let args = PushArgs {
        fcm_service_account: Some(path),
        fcm_endpoint: Some(endpoint.to_owned()),
        fcm_token_endpoint: Some(token_endpoint.to_owned()),
        ..PushArgs::default()
    };
    config::load(args).await.expect("fcm push config")
}

pub async fn upstream_push_config(url: &str) -> PushConfig {
    let args = PushArgs {
        upstream: Some(url.to_owned()),
        ..PushArgs::default()
    };
    config::load(args).await.expect("upstream push config")
}
