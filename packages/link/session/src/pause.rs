use std::time::Duration;

use tokio::time::Instant;

/// The app's own pause, as the link sees it: nothing dials while paused, and a socket a dial
/// opened during the pause is reused by a quick resume.
pub(crate) struct AppPause {
    stale_after: Duration,
    paused_at: Option<Instant>,
}

impl AppPause {
    pub(crate) fn new(stale_after: Duration) -> AppPause {
        AppPause {
            stale_after,
            paused_at: None,
        }
    }

    pub(crate) fn paused(&self) -> bool {
        self.paused_at.is_some()
    }

    pub(crate) fn pause(&mut self, now: Instant) {
        if self.paused_at.is_none() {
            self.paused_at = Some(now);
        }
    }

    /// `None` when the app was not paused. Otherwise whether a socket that survived the pause may
    /// be reused: the app was not away long enough for a peer or a NAT to have dropped it silently.
    pub(crate) fn resume(&mut self, now: Instant) -> Option<bool> {
        let paused_at = self.paused_at.take()?;
        Some(now.saturating_duration_since(paused_at) <= self.stale_after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STALE: Duration = Duration::from_secs(15);

    #[test]
    fn a_quick_resume_may_reuse_the_socket_and_a_late_one_may_not() {
        let base = Instant::now();
        let mut pause = AppPause::new(STALE);
        pause.pause(base);
        assert!(pause.paused());
        assert_eq!(pause.resume(base + STALE), Some(true));
        assert!(!pause.paused());

        pause.pause(base);
        assert_eq!(
            pause.resume(base + STALE + Duration::from_millis(1)),
            Some(false)
        );
    }

    #[test]
    fn a_second_pause_keeps_the_first_instant_and_a_resume_without_pause_is_nothing() {
        let base = Instant::now();
        let mut pause = AppPause::new(STALE);
        assert_eq!(pause.resume(base), None);
        pause.pause(base);
        pause.pause(base + Duration::from_secs(10));
        assert_eq!(pause.resume(base + Duration::from_secs(16)), Some(false));
    }
}
