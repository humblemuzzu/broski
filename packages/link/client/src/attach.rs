use std::time::Duration;

/// What the machine does after a session or terminal view took an answer or a pushed message.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Next {
    Nothing,
    /// Attach (again): after a gap, a replacement, or a replay of a position this phone does not hold.
    Attach,
    /// The bridge refused the attach for its rate limit: send it again after `RATE_LIMIT_PAUSE`.
    AttachLater,
}

/// How long a connection the bridge rate-limited is refused (core README §10: bursts of 150, then
/// 10 s refused); a request it answered `rate_limited` was not served and goes again after it.
pub(crate) const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(10);
