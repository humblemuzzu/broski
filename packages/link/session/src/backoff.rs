use std::time::Duration;

use crate::status::Route;

/// Exponential retry delay, doubling from `min` to `max`, with ±20 % jitter.
pub(crate) struct Backoff {
    min: Duration,
    max: Duration,
    base: Duration,
}

const JITTER: f64 = 0.2;

impl Backoff {
    pub(crate) fn new(min: Duration, max: Duration) -> Backoff {
        Backoff {
            min,
            max,
            base: min,
        }
    }

    /// `random` is uniform in `[0, 1]`; 0.5 hands out the undisturbed delay.
    pub(crate) fn next_delay(&mut self, random: f64) -> Duration {
        let base = self.base;
        self.base = (base * 2).min(self.max);
        base.mul_f64(1.0 + (random * 2.0 - 1.0) * JITTER)
    }

    pub(crate) fn reset(&mut self) {
        self.base = self.min;
    }
}

/// Where the next attempt goes after one failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Retry {
    pub(crate) only: Option<Route>,
    pub(crate) delay: Duration,
}

/// The first failure after a connect switches to the other configured route at once; every later
/// one waits out the backoff and races both routes again.
pub(crate) struct RouteRetry {
    backoff: Backoff,
    switched: bool,
}

impl RouteRetry {
    pub(crate) fn new(backoff: Backoff) -> RouteRetry {
        RouteRetry {
            backoff,
            switched: false,
        }
    }

    pub(crate) fn next(
        &mut self,
        failed: Option<Route>,
        has_route: impl Fn(Route) -> bool,
        random: f64,
    ) -> Retry {
        let other = if failed == Some(Route::Lan) {
            Route::Relay
        } else {
            Route::Lan
        };
        let switch_now = !self.switched && has_route(other);
        self.switched = true;
        if switch_now {
            return Retry {
                only: Some(other),
                delay: Duration::ZERO,
            };
        }
        Retry {
            only: None,
            delay: self.backoff.next_delay(random),
        }
    }

    /// A connect, or a nudge from the app, restores the free switch.
    pub(crate) fn reset(&mut self) {
        self.switched = false;
        self.backoff.reset();
    }
}

/// Uniform in `[0, 1]` from the system source; jitter needs spread, not secrecy, so a source that
/// fails falls back to no jitter.
pub(crate) fn jitter() -> f64 {
    let mut bytes = [0u8; 4];
    match getrandom::fill(&mut bytes) {
        Ok(()) => f64::from(u32::from_le_bytes(bytes)) / f64::from(u32::MAX),
        Err(_) => 0.5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backoff() -> Backoff {
        Backoff::new(Duration::from_millis(500), Duration::from_secs(10))
    }

    #[test]
    fn doubles_from_min_to_max_and_stays_at_max() {
        let mut backoff = backoff();
        let delays: Vec<_> = (0..7).map(|_| backoff.next_delay(0.5)).collect();
        let seconds = |s: f64| Duration::from_secs_f64(s);
        assert_eq!(
            delays,
            [0.5, 1.0, 2.0, 4.0, 8.0, 10.0, 10.0].map(seconds).to_vec()
        );
    }

    #[test]
    fn jitters_the_delay_it_hands_out_by_twenty_percent() {
        assert_eq!(backoff().next_delay(0.0), Duration::from_millis(400));
        assert_eq!(backoff().next_delay(1.0), Duration::from_millis(600));
    }

    #[test]
    fn reset_returns_to_the_shortest_delay() {
        let mut backoff = backoff();
        backoff.next_delay(0.5);
        backoff.next_delay(0.5);
        backoff.reset();
        assert_eq!(backoff.next_delay(0.5), Duration::from_millis(500));
    }

    #[test]
    fn the_first_failure_switches_route_at_once_the_rest_back_off() {
        let mut retry = RouteRetry::new(backoff());
        let all = |_: Route| true;
        let at_once = |only| Retry {
            only,
            delay: Duration::ZERO,
        };
        let later = |millis| Retry {
            only: None,
            delay: Duration::from_millis(millis),
        };
        assert_eq!(
            retry.next(Some(Route::Lan), all, 0.5),
            at_once(Some(Route::Relay))
        );
        assert_eq!(retry.next(Some(Route::Relay), all, 0.5), later(500));
        assert_eq!(retry.next(Some(Route::Lan), all, 0.5), later(1000));
        retry.reset();
        assert_eq!(retry.next(None, all, 0.5), at_once(Some(Route::Lan)));
    }

    #[test]
    fn an_unconfigured_other_route_backs_off_instead_of_switching() {
        let mut retry = RouteRetry::new(backoff());
        let lan_only = |route: Route| route == Route::Lan;
        assert_eq!(
            retry.next(Some(Route::Lan), lan_only, 0.5).delay,
            Duration::from_millis(500)
        );
        assert_eq!(
            retry.next(None, lan_only, 0.5).delay,
            Duration::from_secs(1)
        );
        assert_eq!(retry.next(None, lan_only, 0.5).only, None);
    }

    #[test]
    fn jitter_stays_in_range() {
        for _ in 0..64 {
            assert!((0.0..=1.0).contains(&jitter()));
        }
    }
}
