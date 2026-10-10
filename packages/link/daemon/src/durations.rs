use std::time::Duration;

/// Every window the push, letter, feed and keep-awake paths run on. Tests shrink these instead of
/// waiting them out.
#[derive(Clone, Copy, Debug)]
pub struct Durations {
    pub push_debounce: Duration,
    pub keep_awake_check: Duration,
    pub keep_awake_max: Duration,
    pub letter_ttl: Duration,
    pub letter_future_skew: Duration,
    pub letter_wait: Duration,
    pub feed_ping: Duration,
    pub feed_pong: Duration,
    pub feed_retry_min: Duration,
    pub feed_retry_max: Duration,
    pub bridge_letter_hold: Duration,
    pub sleep_grace: Duration,
}

impl Default for Durations {
    fn default() -> Self {
        Durations {
            push_debounce: Duration::from_secs(60),
            keep_awake_check: Duration::from_secs(60),
            keep_awake_max: Duration::from_secs(8 * 3600),
            letter_ttl: Duration::from_secs(24 * 3600),
            letter_future_skew: Duration::from_secs(5 * 60),
            letter_wait: Duration::from_secs(10),
            feed_ping: Duration::from_secs(30),
            feed_pong: Duration::from_secs(5),
            feed_retry_min: Duration::from_millis(250),
            feed_retry_max: Duration::from_secs(5),
            bridge_letter_hold: Duration::from_secs(30),
            sleep_grace: Duration::from_secs(2),
        }
    }
}
