//! The codes the daemon ends a link session with (`daemon/src/session/close_codes.rs`) and what
//! each one means for the phone.

pub const NORMAL: u16 = 1000;
/// The daemon is shutting down; the phone reconnects when it is back.
pub const SHUTTING_DOWN: u16 = 4001;
/// The phone handed the session more for the bridge than it holds: the bridge's view is stale.
pub const BRIDGE_OVERFLOW: u16 = 4002;
pub const REVOKED: u16 = 4003;
pub const IDLE_EXPIRED: u16 = 4004;
/// The session's own state could not carry on; the phone starts a new one.
pub const SESSION_ERROR: u16 = 4005;

/// What the machine's close codes mean for one link.
#[derive(Default)]
pub(crate) struct PeerClosePolicy {
    code: Option<u16>,
    revoked: bool,
}

impl PeerClosePolicy {
    /// The last close code, kept until a session is up again so every status in between carries
    /// the reason.
    pub(crate) fn code(&self) -> Option<u16> {
        self.code
    }

    pub(crate) fn revoked(&self) -> bool {
        self.revoked
    }

    pub(crate) fn record(&mut self, code: u16) {
        self.code = Some(code);
        self.revoked |= code == REVOKED;
    }

    /// Clears the code and says whether the session that just came up must resync: after a 4002
    /// or a 4005 the bridge forgot this phone's view even when the link session itself resumed.
    pub(crate) fn take_resync(&mut self, session_reset: bool) -> bool {
        let stale = matches!(self.code.take(), Some(BRIDGE_OVERFLOW | SESSION_ERROR));
        session_reset || stale
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_4003_revokes_and_it_stays_revoked() {
        let mut policy = PeerClosePolicy::default();
        for code in [
            NORMAL,
            SHUTTING_DOWN,
            BRIDGE_OVERFLOW,
            IDLE_EXPIRED,
            SESSION_ERROR,
        ] {
            policy.record(code);
            assert!(!policy.revoked(), "{code}");
        }
        policy.record(REVOKED);
        policy.record(NORMAL);
        assert!(policy.revoked());
    }

    #[test]
    fn a_bridge_overflow_or_session_error_makes_the_next_session_resync() {
        for code in [BRIDGE_OVERFLOW, SESSION_ERROR] {
            let mut policy = PeerClosePolicy::default();
            policy.record(code);
            assert_eq!(policy.code(), Some(code));
            assert!(policy.take_resync(false), "{code}");
            assert_eq!(policy.code(), None);
            assert!(!policy.take_resync(false), "{code} resyncs once");
        }
        let mut policy = PeerClosePolicy::default();
        policy.record(SHUTTING_DOWN);
        assert!(!policy.take_resync(false));
        assert!(policy.take_resync(true));
    }
}
