use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::time::Instant;

use crate::error::{Error, Result};

fn base() -> Instant {
    static BASE: OnceLock<Instant> = OnceLock::new();
    *BASE.get_or_init(Instant::now)
}

/// Milliseconds since the first call: the clock the link protocol timers run on.
pub fn now_ms() -> u64 {
    base().elapsed().as_millis() as u64
}

pub fn instant(ms: u64) -> Instant {
    base() + Duration::from_millis(ms)
}

pub fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

pub fn unix_secs() -> u64 {
    unix_ms() / 1000
}

pub fn fill(out: &mut [u8]) -> Result<()> {
    getrandom::fill(out)
        .map_err(|error| Error::message(format!("system randomness unavailable: {error}")))
}

pub fn bytes<const N: usize>() -> Result<[u8; N]> {
    let mut out = [0u8; N];
    fill(&mut out)?;
    Ok(out)
}
