use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::Result;
use crate::fsx;

pub const DEFAULT_LAN_PORT: u16 = 18275;
pub const FILE: &str = "config.json";
pub const DEFAULT_BRIDGE_SOCKET: &str = "bridge.sock";

#[derive(Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub relay: Option<String>,
    #[serde(default)]
    pub lan_port: Option<u16>,
    #[serde(default)]
    pub lan: Option<bool>,
}

pub fn read(home: &Path) -> Result<Config> {
    match fsx::read(&home.join(FILE))? {
        Some(bytes) => Ok(serde_json::from_slice(&bytes)?),
        None => Ok(Config::default()),
    }
}

pub fn home(flag: Option<PathBuf>) -> PathBuf {
    if let Some(path) = flag {
        return path;
    }
    if let Some(path) = std::env::var_os("BROSKI_LINK_HOME") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    let base = std::env::var_os("HOME").map_or_else(|| PathBuf::from("."), PathBuf::from);
    base.join(".broski").join("link")
}
