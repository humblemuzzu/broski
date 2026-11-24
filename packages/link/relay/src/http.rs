use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};

use crate::auth::{b64url_encode, bearer, header, sha256, valid_id, DEVICE_HEADER, MACHINE_HEADER};
use crate::db::MachineAuth;
use crate::hub::Hub;
use crate::limits::{MAX_LETTER_BYTES, MAX_MESSAGE_BYTES, MAX_PUSH_BODY};
use crate::protocol::{now_ms, Identity};
use crate::{device_socket, letters, machine_socket, push};

pub fn router(hub: Arc<Hub>) -> Router {
    let mut router = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/machine", get(machine_upgrade))
        .route("/v1/device", get(device_upgrade))
        .route("/v1/identity/{machine_id}", get(identity))
        .route("/v1/status/{machine_id}", get(status))
        .route(
            "/v1/letters",
            post(letters::post).layer(DefaultBodyLimit::max(MAX_LETTER_BYTES + 1)),
        );
    if hub.push().has_providers() {
        router = router.route(
            "/v1/push",
            post(push::endpoint::post).layer(DefaultBodyLimit::max(MAX_PUSH_BODY)),
        );
    }
    router.with_state(hub)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn machine_upgrade(
    State(hub): State<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !hub.allow_upgrade(peer.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response();
    }
    let Some(machine_id) = header(&headers, MACHINE_HEADER).map(str::to_owned) else {
        return (StatusCode::BAD_REQUEST, "missing machine id").into_response();
    };
    if !valid_id(&machine_id) {
        return (StatusCode::BAD_REQUEST, "malformed machine id").into_response();
    }
    let Some(secret) = bearer(&headers) else {
        return (StatusCode::UNAUTHORIZED, "missing token").into_response();
    };
    let hash = sha256(secret.as_bytes());
    match hub
        .db()
        .authenticate_machine(&machine_id, &hash, now_ms())
        .await
    {
        Ok((MachineAuth::BadSecret, _)) => (StatusCode::UNAUTHORIZED, "bad secret").into_response(),
        Ok((_, last_seen)) => {
            let hub = hub.clone();
            upgrade
                .max_message_size(MAX_MESSAGE_BYTES)
                .max_frame_size(MAX_MESSAGE_BYTES)
                .on_upgrade(move |socket| machine_socket::run(hub, machine_id, last_seen, socket))
                .into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response(),
    }
}

async fn device_upgrade(
    State(hub): State<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !hub.allow_upgrade(peer.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response();
    }
    let Some(auth) = authorized_device(&hub, &headers).await else {
        return unauthorized();
    };
    upgrade
        .max_message_size(MAX_MESSAGE_BYTES)
        .max_frame_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            device_socket::run(hub, auth.machine, auth.device, auth.last_seen, socket)
        })
        .into_response()
}

async fn identity(State(hub): State<Arc<Hub>>, Path(machine_id): Path<String>) -> Response {
    if !valid_id(&machine_id) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match hub.db().identity(&machine_id).await {
        Ok(Some(bundle)) => {
            let public = b64url_encode(&bundle);
            Json(Identity { public: &public }).into_response()
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn status(
    State(hub): State<Arc<Hub>>,
    Path(machine_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    match authorized_device(&hub, &headers).await {
        Some(auth) if auth.machine == machine_id => {}
        _ => return unauthorized(),
    }
    match hub.status(&machine_id).await {
        Ok(status) => Json(status).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub(crate) struct DeviceAuth {
    pub machine: String,
    pub device: String,
    pub last_seen: Option<i64>,
}

pub(crate) async fn authorized_device(hub: &Hub, headers: &HeaderMap) -> Option<DeviceAuth> {
    let machine = header(headers, MACHINE_HEADER)?;
    let device = header(headers, DEVICE_HEADER)?;
    let token = bearer(headers)?;
    if !valid_id(machine) || !valid_id(device) {
        return None;
    }
    let hash = sha256(token.as_bytes());
    let last_seen = hub
        .db()
        .authorize_device(machine, device, &hash)
        .await
        .ok()??;
    Some(DeviceAuth {
        machine: machine.to_owned(),
        device: device.to_owned(),
        last_seen,
    })
}

pub(crate) fn unauthorized() -> Response {
    (StatusCode::UNAUTHORIZED, "not authorized").into_response()
}
