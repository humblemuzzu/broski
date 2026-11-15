use std::time::Duration;

use tokio::time::Instant;

/// The relay answers 401 to a device token it does not hold. A revoked device's token is gone from
/// the relay, but so is the token of a device the machine has not published yet: the machine does
/// that after a pairing, asynchronously, and not at all while it is offline. One refusal says
/// nothing; refusals that keep coming for the whole window, with no connection in between, say the
/// machine does not list this device any more.
pub(crate) struct RelayRefusals {
    window: Duration,
    first: Option<Instant>,
    count: u32,
}

/// Refusals needed besides the window, so a phone that slept through most of it is not judged on
/// two dials.
const MIN_REFUSALS: u32 = 5;

impl RelayRefusals {
    pub(crate) fn new(window: Duration) -> RelayRefusals {
        RelayRefusals {
            window,
            first: None,
            count: 0,
        }
    }

    /// Counts one refusal at `now`; true once the device is to be taken for revoked.
    pub(crate) fn refused(&mut self, now: Instant) -> bool {
        let first = *self.first.get_or_insert(now);
        self.count += 1;
        self.count >= MIN_REFUSALS && now.saturating_duration_since(first) >= self.window
    }

    /// The relay took the token, or some route connected: the streak is over.
    pub(crate) fn reset(&mut self) {
        self.first = None;
        self.count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: Duration = Duration::from_secs(300);

    fn refusals_at(refusals: &mut RelayRefusals, start: Instant, seconds: &[u64]) -> Vec<bool> {
        seconds
            .iter()
            .map(|second| refusals.refused(start + Duration::from_secs(*second)))
            .collect()
    }

    #[test]
    fn many_refusals_inside_the_window_are_not_revocation() {
        let mut refusals = RelayRefusals::new(WINDOW);
        let verdicts = refusals_at(&mut refusals, Instant::now(), &[0, 1, 2, 3, 4, 5, 6, 299]);
        assert!(verdicts.iter().all(|revoked| !revoked), "{verdicts:?}");
    }

    #[test]
    fn refusals_that_span_the_window_are_revocation() {
        let mut refusals = RelayRefusals::new(WINDOW);
        let verdicts = refusals_at(&mut refusals, Instant::now(), &[0, 100, 200, 299, 300]);
        assert_eq!(verdicts, [false, false, false, false, true]);
    }

    #[test]
    fn two_refusals_a_long_pause_apart_are_not_enough() {
        let mut refusals = RelayRefusals::new(WINDOW);
        let verdicts = refusals_at(&mut refusals, Instant::now(), &[0, 86_400]);
        assert_eq!(verdicts, [false, false]);
    }

    #[test]
    fn a_reset_starts_the_streak_over() {
        let mut refusals = RelayRefusals::new(WINDOW);
        let start = Instant::now();
        refusals_at(&mut refusals, start, &[0, 100, 200, 250]);
        refusals.reset();
        let verdicts = refusals_at(&mut refusals, start, &[300, 310, 320, 330, 340]);
        assert_eq!(
            verdicts, [false; 5],
            "the window counts from the first refusal after the reset"
        );
    }
}
