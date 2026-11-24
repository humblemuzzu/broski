use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum ToMachine<'a> {
    Open { ch: u32, device: &'a str },
    Close { ch: u32 },
    Ok { req: u64 },
    Err { req: u64, code: &'a str },
}

#[derive(Serialize)]
pub struct Letter<'a> {
    #[serde(rename = "t")]
    pub t: &'static str,
    pub id: u64,
    pub device: &'a str,
    pub data: &'a str,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct FromMachine {
    pub t: String,
    #[serde(default)]
    pub req: Option<u64>,
    #[serde(default)]
    pub ch: Option<u32>,
    #[serde(default, rename = "pub")]
    pub public: Option<String>,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub token_hash: Option<String>,
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub on: Option<bool>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default, rename = "token")]
    pub push_token: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub collapse: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub targets: Option<Vec<AlertTarget>>,
    #[serde(default)]
    pub devices: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub struct AlertTarget {
    pub device: String,
    pub platform: String,
    pub token: String,
}

#[derive(Serialize)]
pub struct Status<'a> {
    #[serde(rename = "t")]
    pub t: &'static str,
    pub machine: &'a str,
    pub last_seen: Option<i64>,
}

#[derive(Serialize)]
pub struct Identity<'a> {
    #[serde(rename = "pub")]
    pub public: &'a str,
}

pub fn encode<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

pub fn machine_state(online: bool, asleep: bool) -> &'static str {
    match (online, asleep) {
        (false, _) => "offline",
        (true, true) => "asleep",
        (true, false) => "online",
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}
