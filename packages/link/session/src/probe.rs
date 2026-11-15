use std::time::Duration;

use tokio::time::Instant;

/// When the next LAN probe may run while the relay carries the link. A probe dials the LAN
/// candidates one at a time; the policy hands out one probe slot at a time.
pub(crate) struct LanProbePolicy {
    interval: Duration,
    /// The instant the next probe may start, `None` while one runs.
    due: Option<Instant>,
}

impl LanProbePolicy {
    pub(crate) fn new(interval: Duration, now: Instant) -> LanProbePolicy {
        LanProbePolicy {
            interval,
            due: Some(now),
        }
    }

    pub(crate) fn due(&self) -> Option<Instant> {
        self.due
    }

    /// Claims the slot when `now` has reached the due time.
    pub(crate) fn start(&mut self, now: Instant) -> bool {
        match self.due {
            Some(due) if now >= due => {
                self.due = None;
                true
            }
            _ => false,
        }
    }

    /// Releases the slot and schedules the next probe one interval later.
    pub(crate) fn end(&mut self, now: Instant) {
        self.due = Some(now + self.interval);
    }

    /// Pulls the next probe forward to `now`, never later.
    pub(crate) fn resume(&mut self, now: Instant) {
        if let Some(due) = self.due {
            if due > now {
                self.due = Some(now);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(value: u64) -> Duration {
        Duration::from_millis(value)
    }

    #[test]
    fn one_probe_at_a_time_the_next_one_a_full_interval_later() {
        let base = Instant::now();
        let mut policy = LanProbePolicy::new(Duration::from_secs(15), base);
        assert_eq!(policy.due(), Some(base));
        assert!(policy.start(base + ms(100)));
        assert_eq!(policy.due(), None, "in flight");
        assert!(!policy.start(base + ms(30_000)));
        policy.end(base + ms(200));
        assert_eq!(policy.due(), Some(base + ms(15_200)));
        assert!(!policy.start(base + ms(15_000)));
        assert!(policy.start(base + ms(15_200)));
    }

    #[test]
    fn resume_makes_the_next_probe_due_at_once_and_never_later() {
        let base = Instant::now();
        let mut policy = LanProbePolicy::new(Duration::from_secs(15), base);
        policy.start(base);
        policy.end(base);
        policy.resume(base + ms(5_000));
        assert_eq!(policy.due(), Some(base + ms(5_000)));
        policy.resume(base + ms(9_000));
        assert_eq!(policy.due(), Some(base + ms(5_000)));
    }
}
