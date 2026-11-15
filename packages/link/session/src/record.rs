use core::fmt;

use broski_link_core::crypto::PublicBundle;

use crate::endpoint::valid_relay;
use crate::error::Error;

/// How many routes a record keeps beyond the ones the machine reports now, so a machine that
/// moves back to an address it used before is still dialled there.
pub const LAN_ROUTE_HISTORY_MAX: usize = 4;

/// One paired machine, as the app persists it. The session never stores anything: the app hands a
/// record in when it starts a session and persists every `Event::RecordChanged` it is given.
/// `relay_token` and `push_key` are secrets, so the whole record belongs in the Keychain or the
/// Keystore; the notification handlers read the same record to open pushes and post letters.
#[derive(Clone, PartialEq, Eq)]
pub struct MachineRecord {
    /// Lowercase hex of the first 16 bytes of the bundle's SHA-256.
    pub id: String,
    pub name: String,
    pub os: Option<String>,
    /// The machine's 1217-byte public bundle, pinned at pairing.
    pub public_bundle: Vec<u8>,
    /// This phone's device id on that machine: its own identity id.
    pub device_id: String,
    pub relay: Option<String>,
    pub relay_token: Option<String>,
    /// LAN routes, newest first.
    pub lan: Vec<String>,
    /// The 32-byte key K the machine seals pushes with; generated on the phone at pairing.
    pub push_key: Vec<u8>,
    pub paired_at_ms: u64,
}

impl MachineRecord {
    pub(crate) fn bundle(&self) -> Result<PublicBundle, Error> {
        let bundle = PublicBundle::from_bytes(&self.public_bundle)
            .map_err(|_| Error::Record("the public bundle is not a machine bundle"))?;
        if bundle.id() != self.id {
            return Err(Error::Record("the public bundle is not this machine's"));
        }
        Ok(bundle)
    }

    pub(crate) fn push_key(&self) -> Result<[u8; 32], Error> {
        self.push_key
            .as_slice()
            .try_into()
            .map_err(|_| Error::Record("the push key is not 32 bytes"))
    }

    /// Everything a session needs from the record, checked before it dials.
    pub(crate) fn validate(&self) -> Result<PublicBundle, Error> {
        if self
            .relay
            .as_deref()
            .is_some_and(|relay| !valid_relay(relay))
        {
            return Err(Error::Record("the relay is not a ws or wss url"));
        }
        self.push_key()?;
        self.bundle()
    }
}

impl fmt::Debug for MachineRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MachineRecord")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("os", &self.os)
            .field("device_id", &self.device_id)
            .field("relay", &self.relay)
            .field(
                "relay_token",
                &self.relay_token.as_ref().map(|_| "<redacted>"),
            )
            .field("lan", &self.lan)
            .field("push_key", &"<redacted>")
            .field("paired_at_ms", &self.paired_at_ms)
            .finish()
    }
}

/// Every route the machine reports or advertises now, in its order, then up to
/// `LAN_ROUTE_HISTORY_MAX` of the routes the record had before, newest first.
pub fn merge_lan_routes(current: &[String], stored: &[String]) -> Vec<String> {
    let mut merged: Vec<String> = Vec::new();
    for route in current {
        if !route.is_empty() && !merged.contains(route) {
            merged.push(route.clone());
        }
    }
    let history: Vec<String> = stored
        .iter()
        .filter(|route| !route.is_empty() && !merged.contains(route))
        .take(LAN_ROUTE_HISTORY_MAX)
        .cloned()
        .collect();
    merged.extend(history);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn routes(list: &[&str]) -> Vec<String> {
        list.iter().map(|route| (*route).to_owned()).collect()
    }

    #[test]
    fn current_routes_lead_and_history_is_capped_newest_first() {
        let merged = merge_lan_routes(
            &routes(&["c:1", "a:1", "c:1", ""]),
            &routes(&["a:1", "h1:1", "h2:1", "", "h3:1", "h4:1", "h5:1"]),
        );
        assert_eq!(
            merged,
            routes(&["c:1", "a:1", "h1:1", "h2:1", "h3:1", "h4:1"])
        );
    }

    #[test]
    fn no_report_keeps_the_history_alone() {
        assert_eq!(
            merge_lan_routes(&[], &routes(&["a:1", "b:1"])),
            routes(&["a:1", "b:1"])
        );
    }

    #[test]
    fn the_debug_form_never_shows_a_secret() {
        let record = MachineRecord {
            id: "id".into(),
            name: "studio".into(),
            os: None,
            public_bundle: Vec::new(),
            device_id: "device".into(),
            relay: None,
            relay_token: Some("SECRET-TOKEN".into()),
            lan: Vec::new(),
            push_key: vec![0x5a; 32],
            paired_at_ms: 0,
        };
        let text = format!("{record:?}");
        assert!(!text.contains("SECRET-TOKEN"), "{text}");
        assert!(text.contains("<redacted>"));
    }
}
