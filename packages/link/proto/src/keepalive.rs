use crate::config::Config;

pub(crate) enum Action {
    Ping,
    Dead,
}

pub(crate) struct Keepalive {
    idle_ms: u64,
    dead_ms: u64,
    started: bool,
    last_send_ms: u64,
    last_recv_ms: u64,
    dead_reported: bool,
}

impl Keepalive {
    pub(crate) fn new(config: &Config) -> Self {
        Self {
            idle_ms: config.ping_idle_ms,
            dead_ms: config.dead_after_ms,
            started: false,
            last_send_ms: 0,
            last_recv_ms: 0,
            dead_reported: true,
        }
    }

    pub(crate) fn start(&mut self, now_ms: u64) {
        self.started = true;
        self.dead_reported = false;
        self.last_send_ms = now_ms;
        self.last_recv_ms = now_ms;
    }

    pub(crate) fn stop(&mut self) {
        self.started = false;
        self.dead_reported = true;
    }

    pub(crate) fn on_send(&mut self, now_ms: u64) {
        if self.started {
            self.last_send_ms = now_ms;
        }
    }

    pub(crate) fn on_recv(&mut self, now_ms: u64) {
        if self.started {
            self.last_recv_ms = now_ms;
            self.dead_reported = false;
        }
    }

    pub(crate) fn next_deadline(&self) -> Option<u64> {
        if self.dead_reported {
            return None;
        }
        Some(
            self.last_recv_ms
                .saturating_add(self.dead_ms)
                .min(self.last_send_ms.saturating_add(self.idle_ms)),
        )
    }

    pub(crate) fn on_timeout(&mut self, now_ms: u64) -> Option<Action> {
        if self.dead_reported {
            return None;
        }
        if now_ms >= self.last_recv_ms.saturating_add(self.dead_ms) {
            self.dead_reported = true;
            return Some(Action::Dead);
        }
        if now_ms >= self.last_send_ms.saturating_add(self.idle_ms) {
            self.last_send_ms = now_ms;
            return Some(Action::Ping);
        }
        None
    }
}
