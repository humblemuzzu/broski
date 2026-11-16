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
    /// Set by `probe`: nothing received by then makes the connection dead, whatever `dead_ms` says.
    probe_by_ms: Option<u64>,
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
            probe_by_ms: None,
        }
    }

    pub(crate) fn start(&mut self, now_ms: u64) {
        self.started = true;
        self.dead_reported = false;
        self.last_send_ms = now_ms;
        self.last_recv_ms = now_ms;
        self.probe_by_ms = None;
    }

    pub(crate) fn stop(&mut self) {
        self.started = false;
        self.dead_reported = true;
        self.probe_by_ms = None;
    }

    /// The caller sends a ping now; unless a frame arrives within `within_ms`, the connection is
    /// reported dead. False when no connection is being watched.
    pub(crate) fn probe(&mut self, now_ms: u64, within_ms: u64) -> bool {
        if !self.started || self.dead_reported {
            return false;
        }
        let by = now_ms.saturating_add(within_ms);
        self.probe_by_ms = Some(self.probe_by_ms.map_or(by, |earlier| earlier.min(by)));
        self.last_send_ms = now_ms;
        true
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
            self.probe_by_ms = None;
        }
    }

    pub(crate) fn next_deadline(&self) -> Option<u64> {
        if self.dead_reported {
            return None;
        }
        let dead_at = self.last_recv_ms.saturating_add(self.dead_ms);
        let ping_at = self.last_send_ms.saturating_add(self.idle_ms);
        Some(
            dead_at
                .min(ping_at)
                .min(self.probe_by_ms.unwrap_or(u64::MAX)),
        )
    }

    pub(crate) fn on_timeout(&mut self, now_ms: u64) -> Option<Action> {
        if self.dead_reported {
            return None;
        }
        let probe_failed = self.probe_by_ms.is_some_and(|by| now_ms >= by);
        if probe_failed || now_ms >= self.last_recv_ms.saturating_add(self.dead_ms) {
            self.dead_reported = true;
            self.probe_by_ms = None;
            return Some(Action::Dead);
        }
        if now_ms >= self.last_send_ms.saturating_add(self.idle_ms) {
            self.last_send_ms = now_ms;
            return Some(Action::Ping);
        }
        None
    }
}
