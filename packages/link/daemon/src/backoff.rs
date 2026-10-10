use std::time::Duration;

pub struct Backoff {
    min: Duration,
    max: Duration,
    current: Duration,
}

impl Backoff {
    pub fn new(min: Duration, max: Duration) -> Self {
        Backoff {
            min,
            max,
            current: min,
        }
    }

    pub fn reset(&mut self) {
        self.current = self.min;
    }

    /// The delay to wait now, then the next step. Half to one and a half times the
    /// step, so a relay restart does not collect every daemon at the same instant.
    pub fn next(&mut self) -> Duration {
        let delay = jitter(self.current);
        self.current = self.current.saturating_mul(2).min(self.max);
        delay
    }
}

fn jitter(base: Duration) -> Duration {
    let mut sample = [0u8; 8];
    let factor = match getrandom::fill(&mut sample) {
        Ok(()) => 0.5 + (u64::from_le_bytes(sample) % 1000) as f64 / 1000.0,
        Err(_) => 1.0,
    };
    Duration::from_secs_f64(base.as_secs_f64() * factor)
}
