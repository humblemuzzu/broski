//! Per-device notification preferences sent to the daemon on `STREAM_CONTROL`.

use serde_json::json;

/// One session the person muted, by the machine's own ids.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MutedSession {
    pub backend: String,
    pub session: String,
}

/// Which alerts the person wants from a machine. The machine keeps this and sends only those, so a
/// phone that is closed never has to hide what it should not have been sent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotifyPrefs {
    pub needs_you: bool,
    pub done: bool,
    pub failures: bool,
    pub muted: Vec<MutedSession>,
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

pub(crate) fn notify_prefs(prefs: &NotifyPrefs) -> Vec<u8> {
    json!({
        "t": "notify_prefs",
        "needs_you": prefs.needs_you,
        "done": prefs.done,
        "failures": prefs.failures,
        "muted": prefs
            .muted
            .iter()
            .map(|muted| json!({"backend": muted.backend, "session": muted.session}))
            .collect::<Vec<_>>(),
    })
    .to_string()
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    #[test]
    fn notify_prefs_encodes_daemon_shape() {
        let prefs = NotifyPrefs {
            done: false,
            muted: vec![MutedSession {
                backend: "pi".into(),
                session: "s-1".into(),
            }],
            ..NotifyPrefs::default()
        };
        let decoded: Value = serde_json::from_slice(&notify_prefs(&prefs)).expect("json");
        assert_eq!(
            decoded,
            json!({
                "t": "notify_prefs",
                "needs_you": true,
                "done": false,
                "failures": true,
                "muted": [{"backend": "pi", "session": "s-1"}],
            })
        );
    }
}
