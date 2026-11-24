use std::time::Duration;

pub const MAX_MESSAGE_BYTES: usize = 256 * 1024;
pub const MAX_ALLOWED_DEVICES: i64 = 32;
pub const DEVICE_QUEUE_BYTES: usize = 4 * 1024 * 1024;
pub const MACHINE_QUEUE_BYTES: usize = 8 * 1024 * 1024;
pub const SOCKET_QUEUE_MESSAGES: usize = 512;
pub const PING_INTERVAL: Duration = Duration::from_secs(20);
pub const LIVENESS_CHECK: Duration = Duration::from_secs(5);
pub const LIVENESS_TIMEOUT: Duration = Duration::from_secs(45);
pub const WRITER_EXIT_TIMEOUT: Duration = Duration::from_secs(2);
pub const SHUTDOWN_DRAIN: Duration = Duration::from_secs(2);
pub const LAST_SEEN_FLUSH_MS: i64 = 30_000;

pub const MAX_LETTER_BYTES: usize = 64 * 1024;
pub const MAX_LETTERS_PER_MACHINE: i64 = 100;
pub const MAX_LETTER_BYTES_PER_MACHINE: i64 = 1024 * 1024;
pub const LETTER_RATE: RateLimit = RateLimit {
    burst: 60.0,
    per_second: 60.0 / 3600.0,
};

pub const MAX_PUSH_DATA: usize = 3072;
pub const MAX_PUSH_BODY: usize = 16 * 1024;
pub const MAX_PUSH_TOKEN_CHARS: usize = 512;
pub const MAX_COLLAPSE_CHARS: usize = 64;
pub const MAX_ALERT_TARGETS: usize = 32;
pub const PROVIDER_CONCURRENCY: usize = 64;
pub const PROVIDER_BODY_BYTES: usize = 4096;
pub const PROVIDER_TIMEOUT: Duration = Duration::from_secs(10);
pub const APNS_JWT_REFRESH: Duration = Duration::from_secs(50 * 60);
pub const FCM_TOKEN_MARGIN: Duration = Duration::from_secs(60);
pub const PUSH_MACHINE_RATE: RateLimit = RateLimit {
    burst: 120.0,
    per_second: 2.0,
};
pub const PUSH_TOKEN_RATE: RateLimit = RateLimit {
    burst: 30.0,
    per_second: 0.5,
};
pub const PUSH_IP_RATE: RateLimit = RateLimit {
    burst: 120.0,
    per_second: 2.0,
};
/// Per address, for the HTTP routes that read the database before anything else can refuse them
/// (`/v1/identity`, `/v1/status`, `/v1/letters`).
pub const HTTP_IP_RATE: RateLimit = RateLimit {
    burst: 300.0,
    per_second: 5.0,
};

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub letter_ttl: Duration,
    pub sweep_interval: Duration,
    pub alert_grace: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            letter_ttl: Duration::from_secs(24 * 3600),
            sweep_interval: Duration::from_secs(600),
            alert_grace: Duration::from_secs(60),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct RateLimit {
    pub burst: f64,
    pub per_second: f64,
}

impl Default for RateLimit {
    fn default() -> Self {
        Self {
            burst: 10.0,
            per_second: 0.5,
        }
    }
}
