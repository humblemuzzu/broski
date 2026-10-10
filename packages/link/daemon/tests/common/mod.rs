#![allow(dead_code)]

pub mod apns;
pub mod bridge;
pub mod daemon;
pub mod feed;
pub mod phone;
pub mod relay;
pub mod relay_http;
pub mod scenario;

use std::sync::Once;
use std::sync::OnceLock;
use std::time::Duration;

use tokio::time::Instant;

pub use bridge::Headers;

pub fn header(headers: &Headers, name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.clone())
}

pub fn init_logs() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("off"));
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_test_writer()
            .try_init();
    });
}

pub fn base() -> Instant {
    static BASE: OnceLock<Instant> = OnceLock::new();
    *BASE.get_or_init(Instant::now)
}

pub fn now_ms() -> u64 {
    base().elapsed().as_millis() as u64
}

pub fn instant(ms: u64) -> Instant {
    base() + Duration::from_millis(ms)
}
