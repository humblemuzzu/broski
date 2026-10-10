use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use tokio::time::{interval_at, Instant};
use tracing::{debug, info};

use crate::auth::{b64url_encode, truncated};
use crate::db::LetterStored;
use crate::http::{authorized_device, unauthorized};
use crate::hub::Hub;
use crate::limits::MAX_LETTER_BYTES;
use crate::protocol::{encode, now_ms, Letter};
use crate::room::Room;

#[derive(Debug)]
pub struct PendingLetter {
    pub id: u64,
    pub device: String,
    pub data: Vec<u8>,
    pub created_at: i64,
}

#[derive(Serialize)]
struct Posted {
    id: u64,
    delivered: bool,
}

#[derive(Serialize)]
struct Full {
    error: &'static str,
}

pub async fn post(State(hub): State<Arc<Hub>>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(auth) = authorized_device(&hub, &headers).await else {
        return unauthorized();
    };
    if body.len() > MAX_LETTER_BYTES {
        return (StatusCode::PAYLOAD_TOO_LARGE, "letter too large").into_response();
    }
    if !hub.allow_letter(&auth.machine, &auth.device) {
        return (StatusCode::TOO_MANY_REQUESTS, "rate limited").into_response();
    }
    let created_at = now_ms();
    match hub
        .db()
        .insert_letter(&auth.machine, &auth.device, &body, created_at)
        .await
    {
        Ok(LetterStored::Id(id)) => {
            let text = frame(id, &auth.device, &body, created_at);
            let delivered = hub
                .room(&auth.machine)
                .is_some_and(|room| room.deliver_letter(&text));
            info!(
                machine = truncated(&auth.machine),
                device = truncated(&auth.device),
                delivered,
                "letter accepted"
            );
            (StatusCode::ACCEPTED, Json(Posted { id, delivered })).into_response()
        }
        Ok(LetterStored::Full) => (
            StatusCode::INSUFFICIENT_STORAGE,
            Json(Full {
                error: "mailbox_full",
            }),
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

pub fn frame(id: u64, device: &str, data: &[u8], created_at: i64) -> String {
    encode(&Letter {
        t: "letter",
        id,
        device,
        data: &b64url_encode(data),
        created_at,
    })
}

pub fn cutoff(hub: &Hub, now: i64) -> i64 {
    now - hub.limits().letter_ttl.as_millis() as i64
}

pub fn deliver_pending(room: &Room, letters: &[PendingLetter]) {
    for letter in letters {
        let _ = room.deliver_letter(&frame(
            letter.id,
            &letter.device,
            &letter.data,
            letter.created_at,
        ));
    }
}

pub(crate) fn spawn_sweeper(hub: Arc<Hub>) {
    let period = hub.limits().sweep_interval;
    tokio::spawn(async move {
        let mut ticker = interval_at(Instant::now() + period, period);
        loop {
            tokio::select! {
                _ = hub.stopped() => break,
                _ = ticker.tick() => {
                    let expired = cutoff(&hub, now_ms());
                    if let Ok(swept) = hub.db().sweep_letters(expired).await {
                        if swept > 0 {
                            debug!(swept, "letters expired");
                        }
                    }
                }
            }
        }
    });
}
