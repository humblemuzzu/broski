use crate::config::Config;

pub(crate) struct AckPolicy {
    frames: u32,
    bytes: usize,
    deadline_ms: Option<u64>,
    delay_ms: u64,
    every_frames: u32,
    every_bytes: usize,
}

impl AckPolicy {
    pub(crate) fn new(config: &Config) -> Self {
        Self {
            frames: 0,
            bytes: 0,
            deadline_ms: None,
            delay_ms: config.ack_delay_ms,
            every_frames: config.ack_every_frames,
            every_bytes: config.ack_every_bytes,
        }
    }

    /// Counts one accepted DATA frame; `true` means the thresholds want a
    /// standalone ACK right now.
    pub(crate) fn on_data(&mut self, len: usize, now_ms: u64) -> bool {
        self.frames += 1;
        self.bytes += len;
        if self.frames >= self.every_frames || self.bytes >= self.every_bytes {
            self.reset();
            true
        } else {
            if self.deadline_ms.is_none() {
                self.deadline_ms = Some(now_ms.saturating_add(self.delay_ms));
            }
            false
        }
    }

    /// A duplicate means the peer missed our earlier ack, so ack at the next
    /// timeout however far away that is; a burst of duplicates therefore costs
    /// one ACK frame, not one each.
    pub(crate) fn on_duplicate(&mut self, now_ms: u64) {
        self.reset();
        self.deadline_ms = Some(now_ms);
    }

    pub(crate) fn take_due(&mut self, now_ms: u64) -> bool {
        match self.deadline_ms {
            Some(deadline) if now_ms >= deadline => {
                self.reset();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn reset(&mut self) {
        self.frames = 0;
        self.bytes = 0;
        self.deadline_ms = None;
    }

    pub(crate) fn next_deadline(&self) -> Option<u64> {
        self.deadline_ms
    }
}
