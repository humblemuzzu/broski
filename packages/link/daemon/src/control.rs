use serde::{Deserialize, Serialize};

use crate::dialogs::MacDialog;

#[derive(Serialize)]
pub struct MachineInfo<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub os: &'a str,
    pub relay: Option<&'a str>,
    pub lan: &'a [String],
}

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum ToDevice<'a> {
    Paired {
        device_id: &'a str,
        relay_token: &'a str,
        machine: MachineInfo<'a>,
    },
    Routes {
        relay: Option<&'a str>,
        lan: &'a [String],
    },
    Bridge {
        state: &'a str,
        conn: u64,
        detail: Option<&'a str>,
    },
    #[serde(rename = "mac_dialogs")]
    MacDialogs { dialogs: &'a [MacDialog] },
}

#[derive(Deserialize)]
pub struct Hello {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub platform: String,
}

#[derive(Deserialize)]
pub struct PushRegister {
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub key: String,
}

#[derive(Deserialize)]
pub struct LiveActivityRegister {
    #[serde(default)]
    pub token: String,
}

pub enum FromDevice {
    Hello(Hello),
    BridgeRestart,
    PushRegister(PushRegister),
    PushUnregister,
    LiveActivityRegister(LiveActivityRegister),
    LiveActivityUnregister,
    Unknown,
}

/// Unknown `t` is ignored in both directions, so a newer peer never breaks an older one.
pub fn parse_device(bytes: &[u8]) -> FromDevice {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return FromDevice::Unknown;
    };
    match value.get("t").and_then(|tag| tag.as_str()) {
        Some("hello") => match serde_json::from_value(value) {
            Ok(hello) => FromDevice::Hello(hello),
            Err(_) => FromDevice::Unknown,
        },
        Some("bridge_restart") => FromDevice::BridgeRestart,
        Some("push_register") => match serde_json::from_value(value) {
            Ok(register) => FromDevice::PushRegister(register),
            Err(_) => FromDevice::Unknown,
        },
        Some("push_unregister") => FromDevice::PushUnregister,
        Some("live_activity_register") => match serde_json::from_value(value) {
            Ok(register) => FromDevice::LiveActivityRegister(register),
            Err(_) => FromDevice::Unknown,
        },
        Some("live_activity_unregister") => FromDevice::LiveActivityUnregister,
        _ => FromDevice::Unknown,
    }
}
