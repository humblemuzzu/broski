//! Minimal UniFFI facade for the iOS notification service extension: opens sealed pushes from
//! a stored `MachineRecord` without linking the full client core, renderer, or TLS stack.

use std::sync::Arc;

use broski_link_session as link;
use broski_link_session::push;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum PushError {
    #[error("{message}")]
    Failed { message: String },
}

impl From<link::Error> for PushError {
    fn from(error: link::Error) -> Self {
        Self::Failed {
            message: error.to_string(),
        }
    }
}

#[derive(uniffi::Object)]
pub struct MachineRecord(link::MachineRecord);

#[uniffi::export]
impl MachineRecord {
    #[uniffi::constructor]
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Arc<MachineRecord>, PushError> {
        Ok(Arc::new(MachineRecord(link::MachineRecord::from_bytes(
            &bytes,
        )?)))
    }

    pub fn name(&self) -> String {
        self.0.name.clone()
    }
}

pub type PushNotification = push::Notification;

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

#[uniffi::export]
pub fn open_notification(
    record: Arc<MachineRecord>,
    data: String,
) -> Result<PushNotification, PushError> {
    Ok(push::open_notification(&record.0, &data)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_fixture_notification_with_same_record_format() {
        let fixtures =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../mobile/tests/fixtures");
        let record_bytes = std::fs::read(fixtures.join("push-record.json")).expect("record");
        let payload = std::fs::read_to_string(fixtures.join("push.txt")).expect("payload");
        let record = MachineRecord::from_bytes(record_bytes).expect("parse record");
        assert!(!record.name().is_empty());
        let note = open_notification(record, payload.trim().to_owned()).expect("open push");
        assert_eq!(note.kind, "approval");
        assert!(note.request.is_some());
    }
}
