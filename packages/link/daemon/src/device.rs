use broski_link_core::crypto::MAX_NAME_LEN;
use serde::{Deserialize, Serialize};

pub const ROLE_OWNER: &str = "owner";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceRecord {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(rename = "pub")]
    pub public: String,
    pub role: String,
    pub relay_token_hash: String,
    pub paired_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push: Option<PushRegistration>,
}

/// A device's push registration: where to send, and the key its payloads are sealed with.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushRegistration {
    pub platform: String,
    pub token: String,
    pub key: String,
}

#[derive(Serialize)]
pub struct DeviceSummary<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub platform: &'a str,
    pub role: &'a str,
    pub paired_at: u64,
}

impl DeviceRecord {
    pub fn summary(&self) -> DeviceSummary<'_> {
        DeviceSummary {
            id: &self.id,
            name: &self.name,
            platform: &self.platform,
            role: &self.role,
            paired_at: self.paired_at,
        }
    }
}

/// Cuts a name to the 64 bytes the pairing uri allows, on a character boundary.
pub fn clamp_name(name: &str) -> String {
    let mut out = String::new();
    for character in name.chars() {
        if out.len() + character.len_utf8() > MAX_NAME_LEN {
            break;
        }
        out.push(character);
    }
    out
}

/// The ids in every log line and status reply are the first 8 hex characters.
pub fn short(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

pub fn hostname() -> String {
    let mut buffer = [0i8; 256];
    // SAFETY: `buffer` is a live, correctly sized array that outlives the call.
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr(), buffer.len() - 1) };
    if result != 0 {
        return "broski-machine".to_owned();
    }
    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();
    match String::from_utf8(bytes) {
        Ok(name) if !name.trim().is_empty() => name,
        _ => "broski-machine".to_owned(),
    }
}
