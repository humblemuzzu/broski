use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::hub::Hub;
use crate::push::{from_public, PublicPush, PushError};

#[derive(Serialize)]
struct Accepted {
    ok: bool,
}

#[derive(Serialize)]
struct Rejected {
    error: &'static str,
}

pub async fn post(
    State(hub): State<Arc<Hub>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    body: Bytes,
) -> Response {
    if !hub.push().allow_ip(peer.ip()) {
        return refusal(StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    }
    let message = match serde_json::from_slice::<PublicPush>(&body) {
        Ok(message) => message,
        Err(_) => return refusal(StatusCode::BAD_REQUEST, PushError::BadRequest.code()),
    };
    let request = match from_public(message) {
        Ok(request) => request,
        Err(error) => return refusal(status_of(error), error.code()),
    };
    if !hub.push().allow_token(&request.token) {
        return refusal(StatusCode::TOO_MANY_REQUESTS, "rate_limited");
    }
    match hub.push().send(&request).await {
        Ok(()) => Json(Accepted { ok: true }).into_response(),
        Err(error) => refusal(status_of(error), error.code()),
    }
}

fn status_of(error: PushError) -> StatusCode {
    match error {
        PushError::BadRequest => StatusCode::BAD_REQUEST,
        PushError::Unconfigured => StatusCode::NOT_FOUND,
        PushError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
        PushError::Failed | PushError::Rejected | PushError::TokenInvalid => {
            StatusCode::BAD_GATEWAY
        }
    }
}

fn refusal(status: StatusCode, code: &'static str) -> Response {
    (status, Json(Rejected { error: code })).into_response()
}
