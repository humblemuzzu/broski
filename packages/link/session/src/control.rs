//! The link control stream (`STREAM_CONTROL`), `daemon.md` § Link control stream.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Map, Value};

use crate::endpoint::valid_relay;

/// The daemon's bridge, as this session's own bridge socket sees it.
///
/// `Unknown` keeps a newer daemon from being misread: an unrecognised state is still a real
/// change, so it is surfaced rather than dropped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BridgeState {
    Up,
    Connecting,
    Starting,
    Down,
    Crashed,
    Unknown,
}

/// One `{"t":"bridge",…}` message. `conn` counts the bridge sockets this session has had: a new
/// value means the bridge forgot what this phone was shown, so the app resyncs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeStatus {
    pub state: BridgeState,
    pub conn: u64,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Routes {
    pub(crate) relay: Option<String>,
    pub(crate) lan: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Paired {
    pub(crate) device_id: String,
    pub(crate) relay_token: String,
    pub(crate) machine_id: String,
    pub(crate) name: String,
    pub(crate) os: Option<String>,
    pub(crate) routes: Routes,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MacDialog {
    pub id: String,
    pub kind: String,
    pub owner: String,
    pub title: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FromMachine {
    Paired(Paired),
    Routes(Routes),
    Bridge(BridgeStatus),
    MacDialogs(Vec<MacDialog>),
}

/// A known message whose fields are not the contract's; it is refused, never defaulted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Malformed(pub(crate) &'static str);

/// `Ok(None)` for anything this build does not act on: JSON that is not an object, and an unknown
/// `t`, which is ignored so that a newer daemon never breaks an older phone.
pub(crate) fn parse(bytes: &[u8]) -> Result<Option<FromMachine>, Malformed> {
    let Ok(Value::Object(message)) = serde_json::from_slice(bytes) else {
        return Ok(None);
    };
    let parsed = match message.get("t").and_then(Value::as_str) {
        Some("paired") => FromMachine::Paired(paired(&message)?),
        Some("routes") => FromMachine::Routes(routes(&message)?),
        Some("bridge") => FromMachine::Bridge(bridge(&message)?),
        Some("mac_dialogs") => FromMachine::MacDialogs(mac_dialogs(&message)?),
        _ => return Ok(None),
    };
    Ok(Some(parsed))
}

fn bridge(message: &Map<String, Value>) -> Result<BridgeStatus, Malformed> {
    let state = match message.get("state").and_then(Value::as_str) {
        Some("up") => BridgeState::Up,
        Some("connecting") => BridgeState::Connecting,
        Some("starting") => BridgeState::Starting,
        Some("down") => BridgeState::Down,
        Some("crashed") => BridgeState::Crashed,
        Some(_) => BridgeState::Unknown,
        None => return Err(Malformed("bridge status without a state")),
    };
    let conn = message
        .get("conn")
        .and_then(Value::as_u64)
        .ok_or(Malformed("bridge status without a usable conn"))?;
    let detail = message
        .get("detail")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(BridgeStatus {
        state,
        conn,
        detail,
    })
}

fn mac_dialogs(message: &Map<String, Value>) -> Result<Vec<MacDialog>, Malformed> {
    let Some(Value::Array(entries)) = message.get("dialogs") else {
        return Err(Malformed("mac_dialogs has no dialogs list"));
    };
    let mut out = Vec::with_capacity(entries.len().min(32));
    for entry in entries.iter().take(32) {
        let Some(obj) = entry.as_object() else {
            return Err(Malformed("mac_dialogs entry is not an object"));
        };
        let field = |k: &str| {
            obj.get(k)
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(Malformed("mac_dialogs field is not a string"))
        };
        out.push(MacDialog {
            id: field("id")?,
            kind: field("kind")?,
            owner: field("owner")?,
            title: field("title")?,
        });
    }
    Ok(out)
}

fn routes(message: &Map<String, Value>) -> Result<Routes, Malformed> {
    let relay = match message.get("relay") {
        None | Some(Value::Null) => None,
        Some(Value::String(relay)) if valid_relay(relay) => Some(relay.clone()),
        Some(_) => return Err(Malformed("relay is not a ws or wss url")),
    };
    let lan = match message.get("lan") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(entries)) => entries
            .iter()
            .map(|entry| match entry {
                Value::String(host) if !host.is_empty() => Ok(host.clone()),
                _ => Err(Malformed("lan entries are not hosts")),
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(Malformed("lan is not a list")),
    };
    Ok(Routes { relay, lan })
}

fn paired(message: &Map<String, Value>) -> Result<Paired, Malformed> {
    let machine = message
        .get("machine")
        .and_then(Value::as_object)
        .ok_or(Malformed("paired has no machine object"))?;
    let text = |object: &Map<String, Value>, key: &str| {
        object.get(key).and_then(Value::as_str).map(str::to_owned)
    };
    let device_id = text(message, "device_id").filter(|id| is_id(id));
    let machine_id = text(machine, "id").filter(|id| is_id(id));
    let (Some(device_id), Some(machine_id)) = (device_id, machine_id) else {
        return Err(Malformed("paired ids are not 32 lowercase hex"));
    };
    let relay_token = text(message, "relay_token")
        .filter(|token| {
            URL_SAFE_NO_PAD
                .decode(token)
                .is_ok_and(|bytes| bytes.len() == 32)
        })
        .ok_or(Malformed("relay_token is not 32 bytes of b64url"))?;
    let name = text(machine, "name").ok_or(Malformed("machine name is not a string"))?;
    let os = match machine.get("os") {
        None | Some(Value::Null) => None,
        Some(Value::String(os)) => Some(os.clone()),
        Some(_) => return Err(Malformed("machine os is not a string")),
    };
    Ok(Paired {
        device_id,
        relay_token,
        machine_id,
        name,
        os,
        routes: routes(machine)?,
    })
}

fn is_id(text: &str) -> bool {
    text.len() == 32
        && text
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// What this phone runs on, as the daemon names devices.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Ios,
    Android,
}

/// The push service a token belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PushPlatform {
    Apns,
    Fcm,
}

pub(crate) use crate::notify::notify_prefs;

pub(crate) fn screen_pref(enabled: bool) -> Vec<u8> {
    json!({"t": "screen_pref", "enabled": enabled})
        .to_string()
        .into_bytes()
}

pub(crate) fn hello(name: &str, platform: Platform) -> Vec<u8> {
    let platform = match platform {
        Platform::Ios => "ios",
        Platform::Android => "android",
    };
    json!({"t": "hello", "name": name, "platform": platform})
        .to_string()
        .into_bytes()
}

pub(crate) fn push_register(platform: PushPlatform, token: &str, key: &[u8; 32]) -> Vec<u8> {
    let platform = match platform {
        PushPlatform::Apns => "apns",
        PushPlatform::Fcm => "fcm",
    };
    json!({
        "t": "push_register",
        "platform": platform,
        "token": token,
        "key": URL_SAFE_NO_PAD.encode(key),
    })
    .to_string()
    .into_bytes()
}

pub(crate) fn push_unregister() -> Vec<u8> {
    br#"{"t":"push_unregister"}"#.to_vec()
}

pub(crate) fn live_activity_register(token: &str) -> Vec<u8> {
    json!({"t": "live_activity_register", "token": token})
        .to_string()
        .into_bytes()
}

pub(crate) fn live_activity_unregister() -> Vec<u8> {
    br#"{"t":"live_activity_unregister"}"#.to_vec()
}

pub(crate) fn bridge_restart() -> Vec<u8> {
    br#"{"t":"bridge_restart"}"#.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(message: Value) -> Result<Option<FromMachine>, Malformed> {
        parse(message.to_string().as_bytes())
    }

    fn bridge_of(message: Value) -> Option<BridgeStatus> {
        match parsed(message) {
            Ok(Some(FromMachine::Bridge(status))) => Some(status),
            _ => None,
        }
    }

    const ID: &str = "00112233445566778899aabbccddeeff";
    const TOKEN: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    #[test]
    fn every_bridge_state_the_daemon_sends_has_a_value_and_a_new_one_is_unknown() {
        for (raw, state) in [
            ("up", BridgeState::Up),
            ("connecting", BridgeState::Connecting),
            ("starting", BridgeState::Starting),
            ("down", BridgeState::Down),
            ("crashed", BridgeState::Crashed),
            ("restarting", BridgeState::Unknown),
        ] {
            let status = bridge_of(json!({"t": "bridge", "state": raw, "conn": 7, "detail": null}));
            assert_eq!(status.map(|status| status.state), Some(state), "{raw}");
        }
    }

    #[test]
    fn a_missing_or_unusable_conn_or_state_is_refused_rather_than_defaulted() {
        for message in [
            json!({"t": "bridge", "state": "up"}),
            json!({"t": "bridge", "state": "up", "conn": null}),
            json!({"t": "bridge", "state": "up", "conn": "3"}),
            json!({"t": "bridge", "state": "up", "conn": 1.5}),
            json!({"t": "bridge", "state": "up", "conn": -1}),
            json!({"t": "bridge", "conn": 1}),
            json!({"t": "bridge", "state": 1, "conn": 1}),
        ] {
            assert!(parsed(message.clone()).is_err(), "{message}");
        }
    }

    #[test]
    fn a_non_string_detail_is_dropped_not_carried() {
        let status =
            bridge_of(json!({"t": "bridge", "state": "crashed", "conn": 4, "detail": {"why": 1}}));
        assert_eq!(
            status,
            Some(BridgeStatus {
                state: BridgeState::Crashed,
                conn: 4,
                detail: None
            })
        );
    }

    #[test]
    fn unknown_messages_and_non_objects_are_ignored() {
        assert_eq!(parsed(json!({"t": "future", "x": 1})), Ok(None));
        assert_eq!(parsed(json!([1, 2])), Ok(None));
        assert_eq!(parse(b"not json"), Ok(None));
    }

    #[test]
    fn routes_are_parsed_strictly() {
        let routes =
            parsed(json!({"t": "routes", "relay": "wss://relay.example", "lan": ["10.0.0.2:1"]}));
        assert_eq!(
            routes,
            Ok(Some(FromMachine::Routes(Routes {
                relay: Some("wss://relay.example".to_owned()),
                lan: vec!["10.0.0.2:1".to_owned()],
            })))
        );
        let empty = parsed(json!({"t": "routes", "relay": null, "lan": []}));
        assert_eq!(
            empty,
            Ok(Some(FromMachine::Routes(Routes {
                relay: None,
                lan: Vec::new()
            })))
        );
        for message in [
            json!({"t": "routes", "relay": "https://relay.example", "lan": []}),
            json!({"t": "routes", "relay": 3, "lan": []}),
            json!({"t": "routes", "relay": null, "lan": "10.0.0.2:1"}),
            json!({"t": "routes", "relay": null, "lan": [""]}),
            json!({"t": "routes", "relay": null, "lan": [4]}),
        ] {
            assert!(parsed(message.clone()).is_err(), "{message}");
        }
    }

    fn paired_message() -> Value {
        json!({
            "t": "paired",
            "device_id": ID,
            "relay_token": TOKEN,
            "machine": {"id": ID, "name": "studio", "os": "macos", "relay": null, "lan": ["10.0.0.2:1"]},
        })
    }

    #[test]
    fn paired_carries_the_machine_and_the_relay_token() {
        let Ok(Some(FromMachine::Paired(paired))) = parsed(paired_message()) else {
            panic!("paired parses");
        };
        assert_eq!(paired.device_id, ID);
        assert_eq!(paired.relay_token, TOKEN);
        assert_eq!(paired.name, "studio");
        assert_eq!(paired.os.as_deref(), Some("macos"));
        assert_eq!(paired.routes.lan, ["10.0.0.2:1"]);
    }

    #[test]
    fn a_paired_message_off_the_contract_is_refused() {
        let broken: [(&str, Value); 6] = [
            ("/device_id", json!("ABC")),
            ("/relay_token", json!("short")),
            ("/relay_token", Value::Null),
            ("/machine/id", json!(42)),
            ("/machine/name", Value::Null),
            ("/machine/os", json!(1)),
        ];
        for (pointer, value) in broken {
            let mut message = paired_message();
            *message.pointer_mut(pointer).expect("field") = value;
            assert!(parsed(message).is_err(), "{pointer}");
        }
    }

    #[test]
    fn outgoing_messages_have_the_daemon_shapes() {
        let decode = |bytes: Vec<u8>| serde_json::from_slice::<Value>(&bytes).expect("json");
        assert_eq!(
            decode(hello("iPhone", Platform::Ios)),
            json!({"t": "hello", "name": "iPhone", "platform": "ios"})
        );
        let key: [u8; 32] = std::array::from_fn(|index| index as u8);
        assert_eq!(
            decode(push_register(PushPlatform::Fcm, "tok", &key)),
            json!({"t": "push_register", "platform": "fcm", "token": "tok", "key": TOKEN})
        );
        assert_eq!(decode(push_unregister()), json!({"t": "push_unregister"}));
        assert_eq!(decode(bridge_restart()), json!({"t": "bridge_restart"}));
    }
}
