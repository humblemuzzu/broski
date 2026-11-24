use broski_link_core::crypto::MAX_NAME_LEN;
use serde::{Deserialize, Serialize};

use crate::push::Kind;

/// How many muted sessions a device may ask the machine to remember.
pub const MAX_MUTED: usize = 512;
/// Longest backend or session id accepted in `NotifyPrefs` (matches contract `MAX_ID_CHARS`).
pub const MAX_ID_LEN: usize = 256;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live_activity_token: Option<String>,
    #[serde(default, skip_serializing_if = "NotifyPrefs::is_default")]
    pub notify: NotifyPrefs,
    #[serde(default, skip_serializing_if = "is_false")]
    pub remote_screen: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// One session the person muted on a device; the machine is the one holding this record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct MutedSession {
    pub backend: String,
    pub session: String,
}

/// What a device wants pushed, as the phone's settings say. Everything is on until turned off,
/// and the machine keeps it so an alert the person turned off is never sent: a phone that is
/// asleep or closed cannot be asked to hide it afterwards.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NotifyPrefs {
    #[serde(default = "yes")]
    pub needs_you: bool,
    #[serde(default = "yes")]
    pub done: bool,
    #[serde(default = "yes")]
    pub failures: bool,
    #[serde(default)]
    pub muted: Vec<MutedSession>,
}

fn yes() -> bool {
    true
}

impl Default for NotifyPrefs {
    fn default() -> NotifyPrefs {
        NotifyPrefs {
            needs_you: true,
            done: true,
            failures: true,
            muted: Vec::new(),
        }
    }
}

impl NotifyPrefs {
    pub fn is_default(&self) -> bool {
        *self == NotifyPrefs::default()
    }

    pub fn mutes(&self, backend: &str, session: &str) -> bool {
        self.muted
            .iter()
            .any(|muted| muted.backend == backend && muted.session == session)
    }

    /// Whether an alert of `kind` about this session is wanted.
    pub fn wants(&self, kind: Kind, backend: &str, session: &str) -> bool {
        let kind_on = match kind {
            Kind::Approval | Kind::Attention => self.needs_you,
            Kind::Done => self.done,
            Kind::Failed => self.failures,
        };
        kind_on && !self.mutes(backend, session)
    }

    /// Keeps the machine's record bounded however long a phone's list or ids are.
    pub fn bounded(mut self) -> NotifyPrefs {
        let mut seen = std::collections::HashSet::new();
        self.muted.retain(|m| {
            !m.backend.is_empty()
                && !m.session.is_empty()
                && m.backend.len() <= MAX_ID_LEN
                && m.session.len() <= MAX_ID_LEN
                && seen.insert((m.backend.clone(), m.session.clone()))
        });
        self.muted.truncate(MAX_MUTED);
        self
    }
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

/// The name a fresh machine state carries: the Mac's Computer Name ("Sam's MacBook Pro", as
/// System Settings shows it), else the network host name.
pub fn machine_name() -> String {
    computer_name().unwrap_or_else(hostname)
}

fn computer_name() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8(output.stdout).ok()?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_choice_turns_off_its_kind_and_a_muted_session_turns_off_every_kind() {
        let mut prefs = NotifyPrefs {
            done: false,
            ..NotifyPrefs::default()
        };
        assert!(prefs.wants(Kind::Approval, "pi", "s-1"));
        assert!(prefs.wants(Kind::Attention, "pi", "s-1"));
        assert!(!prefs.wants(Kind::Done, "pi", "s-1"));
        assert!(prefs.wants(Kind::Failed, "pi", "s-1"));
        prefs.muted.push(MutedSession {
            backend: "pi".to_owned(),
            session: "s-1".to_owned(),
        });
        assert!(!prefs.wants(Kind::Approval, "pi", "s-1"));
        assert!(prefs.wants(Kind::Approval, "pi", "s-2"));
        assert!(prefs.wants(Kind::Approval, "claude-code", "s-1"));
    }

    #[test]
    fn a_record_without_settings_wants_everything_and_stays_out_of_the_file() {
        let device: DeviceRecord = serde_json::from_str(
            r#"{"id":"d","public":"","pub":"p","role":"owner","relay_token_hash":"h","paired_at":1}"#,
        )
        .expect("an older record reads");
        assert!(device.notify.is_default());
        let written = serde_json::to_value(&device).expect("json");
        assert!(written.get("notify").is_none());
    }

    #[test]
    fn a_phone_cannot_make_the_machine_remember_more_than_the_bound() {
        let muted = (0..MAX_MUTED + 10)
            .map(|index| MutedSession {
                backend: "pi".to_owned(),
                session: index.to_string(),
            })
            .collect();
        let prefs = NotifyPrefs {
            muted,
            ..NotifyPrefs::default()
        }
        .bounded();
        assert_eq!(prefs.muted.len(), MAX_MUTED);

        let oversized = NotifyPrefs {
            muted: vec![
                MutedSession {
                    backend: "x".repeat(MAX_ID_LEN + 1),
                    session: "ok".into(),
                },
                MutedSession {
                    backend: "pi".into(),
                    session: "y".repeat(MAX_ID_LEN + 1),
                },
                MutedSession {
                    backend: "pi".into(),
                    session: "ok".into(),
                },
                MutedSession {
                    backend: "pi".into(),
                    session: "ok".into(),
                },
            ],
            ..NotifyPrefs::default()
        }
        .bounded();
        assert_eq!(
            oversized.muted,
            vec![MutedSession {
                backend: "pi".into(),
                session: "ok".into(),
            }]
        );
    }
}
