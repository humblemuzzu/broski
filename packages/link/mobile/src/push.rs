//! What the iOS notification service extension and the Android message handler call. Both are
//! pure: neither needs a `Phone`, only the machine's stored record.

use std::sync::Arc;

use broski_client::ClientError;
use broski_link_session::push;

use crate::record::MachineRecord;

pub type PushNotification = push::Notification;
pub type PushDecision = push::Decision;

#[uniffi::remote(Record)]
pub struct PushNotification {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub machine: String,
    pub backend: String,
    pub session: String,
    pub request: Option<String>,
    pub at_ms: u64,
}

#[uniffi::remote(Enum)]
pub enum PushDecision {
    Allow,
    Deny,
}

#[derive(uniffi::Record)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

/// The `POST` that carries a lock-screen decision to the relay; `body` is opaque to the relay.
#[derive(uniffi::Record)]
pub struct LetterRequest {
    pub url: String,
    pub headers: Vec<HttpHeader>,
    pub body: Vec<u8>,
}

/// Opens the `e` (APNs) or `data.e` (FCM) field of a push from `record`'s machine.
#[uniffi::export]
pub fn open_notification(
    record: Arc<MachineRecord>,
    data: String,
) -> Result<PushNotification, ClientError> {
    Ok(push::open_notification(&record.0, &data)?)
}

/// Seals a decision on `request` of `session` as a letter for `record`'s machine.
#[uniffi::export]
pub fn decision_letter(
    record: Arc<MachineRecord>,
    decision: PushDecision,
    backend: String,
    session: String,
    request: Option<String>,
) -> Result<LetterRequest, ClientError> {
    let letter =
        push::decision_letter(&record.0, decision, &backend, &session, request.as_deref())?;
    Ok(LetterRequest {
        url: letter.url,
        headers: letter
            .headers
            .into_iter()
            .map(|(name, value)| HttpHeader { name, value })
            .collect(),
        body: letter.body,
    })
}
