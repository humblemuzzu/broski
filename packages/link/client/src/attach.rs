use std::time::Duration;

use broski_contract::ProtocolErrorCode;
use tokio::time::Instant;

/// What the machine does after a session or terminal view took an answer or a pushed message.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Next {
    Nothing,
    /// Attach (again): after a gap, bad data, a replacement, or a replay of a position this
    /// phone does not hold. The view is detached by then, which is all the machine attaches.
    Attach,
    /// Attach again after this pause: the bridge refused the attach for a reason that passes, or
    /// the link did not send it. The view is detached meanwhile and keeps what it knew.
    AttachAfter(Duration),
}

/// How long a connection the bridge rate-limited is refused (core README §10: bursts of 150, then
/// 10 s refused); a request it answered `rate_limited` was not served and goes again after it.
pub(crate) const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(10);

const RETRY_FIRST: Duration = Duration::from_secs(1);
const RETRY_MAX: Duration = Duration::from_secs(30);

/// How long a view goes on attaching while every attempt fails, from the first failure in a row;
/// the first failure after it ends the view refused.
pub(crate) const RETRY_WINDOW: Duration = Duration::from_secs(5 * 60);

/// Refusals as `unknown_session` since the view was last attached that end it: the bridge also
/// answers so for a session that closed while the attach waited for it, which the next attach opens
/// again.
pub(crate) const UNKNOWN_SESSION_REFUSALS: u32 = 3;

/// The pause before trying again after `earlier` failures in a row before this one: 1 s, doubling
/// with each, at most 30 s.
pub(crate) fn backoff(earlier: u32) -> Duration {
    RETRY_FIRST
        .saturating_mul(2u32.saturating_pow(earlier))
        .min(RETRY_MAX)
}

/// The failed attaches of one view since it was last attached.
#[derive(Debug, Default)]
pub(crate) struct AttachRetry {
    failures: u32,
    since: Option<Instant>,
    unknown_session: u32,
}

impl AttachRetry {
    /// Attached: the next failure starts a new run of them.
    pub(crate) fn succeeded(&mut self) {
        *self = AttachRetry::default();
    }

    /// The pause before attaching again after the bridge answered `code`, or `None` when the view
    /// should end: the bridge will not serve this attach however often it is sent.
    pub(crate) fn refused(&mut self, code: ProtocolErrorCode, now: Instant) -> Option<Duration> {
        match code {
            ProtocolErrorCode::InvalidMessage | ProtocolErrorCode::UnsupportedVersion => None,
            ProtocolErrorCode::UnknownSession => {
                self.unknown_session += 1;
                if self.unknown_session >= UNKNOWN_SESSION_REFUSALS {
                    return None;
                }
                self.failed(now)
            }
            ProtocolErrorCode::RateLimited => {
                self.failed(now).map(|pause| pause.max(RATE_LIMIT_PAUSE))
            }
            ProtocolErrorCode::UnknownBackend
            | ProtocolErrorCode::NotAttached
            | ProtocolErrorCode::Internal => self.failed(now),
        }
    }

    /// The pause before attaching again after the link did not send the attach, or `None` once
    /// that has gone on for the whole window.
    pub(crate) fn failed(&mut self, now: Instant) -> Option<Duration> {
        let since = *self.since.get_or_insert(now);
        if now.duration_since(since) >= RETRY_WINDOW {
            return None;
        }
        let pause = backoff(self.failures);
        self.failures += 1;
        Some(pause)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passing_refusals_back_off_to_the_cap_and_end_after_the_window() {
        let mut retry = AttachRetry::default();
        let start = Instant::now();
        let pauses: Vec<u64> = (0..7)
            .map(|_| retry.refused(ProtocolErrorCode::Internal, start))
            .map(|pause| pause.expect("retried").as_secs())
            .collect();
        assert_eq!(pauses, [1, 2, 4, 8, 16, 30, 30]);
        let late = start + RETRY_WINDOW - Duration::from_secs(1);
        assert!(retry
            .refused(ProtocolErrorCode::UnknownBackend, late)
            .is_some());
        assert!(retry
            .refused(ProtocolErrorCode::NotAttached, start + RETRY_WINDOW)
            .is_none());

        retry.succeeded();
        let later = start + RETRY_WINDOW * 2;
        assert_eq!(
            retry.refused(ProtocolErrorCode::Internal, later),
            Some(RETRY_FIRST),
            "an attach that succeeded starts the window and the pause over"
        );
    }

    #[test]
    fn a_rate_limit_waits_out_the_limit_and_definitive_refusals_end_at_once() {
        let now = Instant::now();
        assert_eq!(
            AttachRetry::default().refused(ProtocolErrorCode::RateLimited, now),
            Some(RATE_LIMIT_PAUSE)
        );
        for code in [
            ProtocolErrorCode::InvalidMessage,
            ProtocolErrorCode::UnsupportedVersion,
        ] {
            assert!(
                AttachRetry::default().refused(code, now).is_none(),
                "{code:?}"
            );
        }
    }

    #[test]
    fn an_unknown_session_is_tried_a_few_times_then_believed() {
        let mut retry = AttachRetry::default();
        let now = Instant::now();
        for _ in 1..UNKNOWN_SESSION_REFUSALS {
            assert!(retry
                .refused(ProtocolErrorCode::UnknownSession, now)
                .is_some());
            assert!(
                retry.refused(ProtocolErrorCode::Internal, now).is_some(),
                "other refusals between them do not count"
            );
        }
        assert!(retry
            .refused(ProtocolErrorCode::UnknownSession, now)
            .is_none());
    }
}
