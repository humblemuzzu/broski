//! The bytes an app stores a `MachineRecord` as, in the Keychain or the Keystore, and reads back in
//! the app and in its notification handlers.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Map, Value};

use crate::error::Error;
use crate::record::MachineRecord;

/// Bumped when a field changes meaning; a record in another format is refused, never guessed at.
const FORMAT: u64 = 1;

const MALFORMED: Error = Error::Record("the stored record is malformed");

impl MachineRecord {
    /// Versioned JSON with the bundle and the push key in b64url. It carries the record's secrets.
    pub fn to_bytes(&self) -> Vec<u8> {
        json!({
            "v": FORMAT,
            "id": self.id,
            "name": self.name,
            "os": self.os,
            "public_bundle": URL_SAFE_NO_PAD.encode(&self.public_bundle),
            "device_id": self.device_id,
            "relay": self.relay,
            "relay_token": self.relay_token,
            "lan": self.lan,
            "push_key": URL_SAFE_NO_PAD.encode(&self.push_key),
            "paired_at_ms": self.paired_at_ms,
        })
        .to_string()
        .into_bytes()
    }

    /// Reads what `to_bytes` wrote. Only the shape is checked here; `Session::start` and the push
    /// functions check the bundle and the push key when they use them.
    pub fn from_bytes(bytes: &[u8]) -> Result<MachineRecord, Error> {
        let value: Value = serde_json::from_slice(bytes).map_err(|_| MALFORMED)?;
        let stored = value.as_object().ok_or(MALFORMED)?;
        if stored.get("v").and_then(Value::as_u64) != Some(FORMAT) {
            return Err(Error::Record("the stored record is in an unknown format"));
        }
        Ok(MachineRecord {
            id: text(stored, "id")?,
            name: text(stored, "name")?,
            os: optional_text(stored, "os")?,
            public_bundle: b64url(stored, "public_bundle")?,
            device_id: text(stored, "device_id")?,
            relay: optional_text(stored, "relay")?,
            relay_token: optional_text(stored, "relay_token")?,
            lan: lan(stored)?,
            push_key: b64url(stored, "push_key")?,
            paired_at_ms: stored
                .get("paired_at_ms")
                .and_then(Value::as_u64)
                .ok_or(MALFORMED)?,
        })
    }
}

fn text(stored: &Map<String, Value>, key: &str) -> Result<String, Error> {
    stored
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(MALFORMED)
}

fn optional_text(stored: &Map<String, Value>, key: &str) -> Result<Option<String>, Error> {
    match stored.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        _ => Err(MALFORMED),
    }
}

fn b64url(stored: &Map<String, Value>, key: &str) -> Result<Vec<u8>, Error> {
    URL_SAFE_NO_PAD
        .decode(text(stored, key)?)
        .map_err(|_| MALFORMED)
}

fn lan(stored: &Map<String, Value>) -> Result<Vec<String>, Error> {
    stored
        .get("lan")
        .and_then(Value::as_array)
        .ok_or(MALFORMED)?
        .iter()
        .map(|route| route.as_str().map(str::to_owned).ok_or(MALFORMED))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> MachineRecord {
        MachineRecord {
            id: "00112233445566778899aabbccddeeff".into(),
            name: "studio \"mac\"".into(),
            os: Some("macos".into()),
            public_bundle: (0..=255).collect(),
            device_id: "ffeeddccbbaa99887766554433221100".into(),
            relay: Some("wss://relay.example".into()),
            relay_token: Some("token".into()),
            lan: vec!["10.0.0.2:7878".into(), "192.168.1.4:7878".into()],
            push_key: vec![7; 32],
            paired_at_ms: 1_725_000_000_000,
        }
    }

    #[test]
    fn a_record_reads_back_as_it_was_written() {
        let full = record();
        assert_eq!(MachineRecord::from_bytes(&full.to_bytes()).ok(), Some(full));
        let bare = MachineRecord {
            os: None,
            relay: None,
            relay_token: None,
            lan: Vec::new(),
            ..record()
        };
        assert_eq!(MachineRecord::from_bytes(&bare.to_bytes()).ok(), Some(bare));
    }

    #[test]
    fn another_format_or_a_broken_field_is_refused() {
        let stored = |edit: fn(&mut Map<String, Value>)| {
            let mut value: Value = serde_json::from_slice(&record().to_bytes()).expect("json");
            edit(value.as_object_mut().expect("object"));
            MachineRecord::from_bytes(value.to_string().as_bytes())
        };
        assert!(stored(|_| {}).is_ok());
        let broken: [fn(&mut Map<String, Value>); 7] = [
            |stored| drop(stored.insert("v".into(), json!(2))),
            |stored| drop(stored.remove("v")),
            |stored| drop(stored.remove("os")),
            |stored| drop(stored.insert("push_key".into(), json!("not b64url!"))),
            |stored| drop(stored.insert("lan".into(), json!([1]))),
            |stored| drop(stored.insert("relay_token".into(), json!(5))),
            |stored| drop(stored.insert("paired_at_ms".into(), json!(-1))),
        ];
        for edit in broken {
            assert!(matches!(stored(edit), Err(Error::Record(_))));
        }
        assert!(MachineRecord::from_bytes(b"not json").is_err());
    }
}
