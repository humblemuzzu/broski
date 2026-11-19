use serde::Deserialize;

use crate::auth::{b64url_decode, valid_id};
use crate::limits::{MAX_COLLAPSE_CHARS, MAX_PUSH_DATA};
use crate::protocol::FromMachine;
use crate::push::{valid_token, Kind, Platform, Priority, PushError, PushRequest};

#[derive(Deserialize)]
pub struct PublicPush {
    platform: Option<String>,
    token: Option<String>,
    kind: Option<String>,
    data: Option<String>,
    collapse: Option<String>,
    priority: Option<String>,
    machine: Option<String>,
}

pub fn from_machine(message: &FromMachine, machine: &str) -> Result<PushRequest, PushError> {
    let request = build(
        message.platform.as_deref(),
        message.push_token.as_deref(),
        message.kind.as_deref(),
        message.data.as_deref(),
        message.collapse.as_deref(),
        message.priority.as_deref(),
        machine,
    )?;
    if request.kind == Kind::Offline {
        return Err(PushError::BadRequest);
    }
    Ok(request)
}

pub fn from_public(message: PublicPush) -> Result<PushRequest, PushError> {
    build(
        message.platform.as_deref(),
        message.token.as_deref(),
        message.kind.as_deref(),
        message.data.as_deref(),
        message.collapse.as_deref(),
        message.priority.as_deref(),
        message.machine.as_deref().unwrap_or_default(),
    )
}

#[allow(clippy::too_many_arguments)]
fn build(
    platform: Option<&str>,
    token: Option<&str>,
    kind: Option<&str>,
    data: Option<&str>,
    collapse: Option<&str>,
    priority: Option<&str>,
    machine: &str,
) -> Result<PushRequest, PushError> {
    let platform = platform
        .and_then(Platform::parse)
        .ok_or(PushError::BadRequest)?;
    let token = token
        .filter(|token| valid_token(token))
        .ok_or(PushError::BadRequest)?;
    let kind = kind.and_then(Kind::parse).ok_or(PushError::BadRequest)?;
    if (platform == Platform::ApnsLiveActivity) != (kind == Kind::LiveActivity) {
        return Err(PushError::BadRequest);
    }
    let encoded = data.ok_or(PushError::BadRequest)?;
    if encoded.len() > MAX_PUSH_DATA * 4 / 3 + 4 {
        return Err(PushError::BadRequest);
    }
    let data = b64url_decode(encoded).ok_or(PushError::BadRequest)?;
    if data.len() > MAX_PUSH_DATA {
        return Err(PushError::BadRequest);
    }
    if platform == Platform::ApnsLiveActivity
        && !serde_json::from_slice::<serde_json::Value>(&data).is_ok_and(|value| value.is_object())
    {
        return Err(PushError::BadRequest);
    }
    let collapse = match collapse {
        None => None,
        Some(text) if valid_token(text) && text.len() <= MAX_COLLAPSE_CHARS => {
            Some(text.to_owned())
        }
        Some(_) => return Err(PushError::BadRequest),
    };
    let priority = match priority {
        None => Priority::High,
        Some(text) => Priority::parse(text).ok_or(PushError::BadRequest)?,
    };
    if !machine.is_empty() && !valid_id(machine) {
        return Err(PushError::BadRequest);
    }
    Ok(PushRequest {
        machine: machine.to_owned(),
        platform,
        token: token.to_owned(),
        kind,
        data,
        collapse,
        priority,
    })
}
