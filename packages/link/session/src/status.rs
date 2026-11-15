/// Which transport carries the link.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Route {
    Lan,
    Relay,
}

/// Why no handshake is in flight.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaitReason {
    /// The last attempt failed and the next one is scheduled.
    Retry,
    /// The app is in the background; nothing dials until it resumes.
    Paused,
    /// The relay says the machine is not connected to it. Its socket stays open and the
    /// handshake starts the moment the machine is back.
    MachineOffline,
    /// The machine told the relay it was going to sleep.
    MachineAsleep,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkState {
    /// Routes are being dialled, or a socket is open and its handshake is in flight.
    Connecting,
    /// `session_reset` is true on exactly one status: the first one after the machine started a
    /// new session in place of one this phone held, or after it closed with 4002/4005. Whatever
    /// the app had in flight is gone and it must resync.
    Connected {
        resumed: bool,
        session_reset: bool,
    },
    Waiting(WaitReason),
    /// The machine revoked this device (close code 4003). Terminal: only a new pairing helps.
    Revoked,
    /// The app closed the session. Terminal.
    Closed,
}

/// One snapshot of a session's link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Status {
    pub state: LinkState,
    /// The route of the socket in use, `None` while none is open.
    pub route: Option<Route>,
    /// `host:port` of the LAN candidate, or the relay host.
    pub route_detail: Option<String>,
    /// What the relay last reported as the machine's last contact, unix ms.
    pub last_seen_ms: Option<u64>,
    /// The code the machine last closed the session with, kept until a session is up again.
    pub close_code: Option<u16>,
}

impl Status {
    pub(crate) fn starting() -> Status {
        Status {
            state: LinkState::Connecting,
            route: None,
            route_detail: None,
            last_seen_ms: None,
            close_code: None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self.state, LinkState::Revoked | LinkState::Closed)
    }
}

/// Builds the snapshots the app sees and says which ones are news.
pub(crate) struct StatusReporter {
    last: Status,
    last_seen_ms: Option<u64>,
}

impl StatusReporter {
    pub(crate) fn new() -> StatusReporter {
        StatusReporter {
            last: Status::starting(),
            last_seen_ms: None,
        }
    }

    pub(crate) fn state(&self) -> LinkState {
        self.last.state
    }

    pub(crate) fn saw_machine(&mut self, at_ms: Option<u64>) {
        if at_ms.is_some() {
            self.last_seen_ms = at_ms;
        }
    }

    /// The status to publish, or `None` when it repeats the last one. A session reset is always
    /// news: two resets in a row carry the same route and the second still has to reach the app.
    pub(crate) fn report(
        &mut self,
        state: LinkState,
        route: Option<(Route, String)>,
        close_code: Option<u16>,
    ) -> Option<Status> {
        let (route, route_detail) =
            route.map_or((None, None), |(route, detail)| (Some(route), Some(detail)));
        let status = Status {
            state,
            route,
            route_detail,
            last_seen_ms: self.last_seen_ms,
            close_code,
        };
        let reset = matches!(
            state,
            LinkState::Connected {
                session_reset: true,
                ..
            }
        );
        if status == self.last && !reset {
            return None;
        }
        self.last = status.clone();
        Some(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relay() -> Option<(Route, String)> {
        Some((Route::Relay, "relay.example".to_owned()))
    }

    #[test]
    fn a_repeat_of_the_same_status_is_not_news() {
        let mut reporter = StatusReporter::new();
        let waiting = LinkState::Waiting(WaitReason::Retry);
        assert!(reporter.report(waiting, relay(), None).is_some());
        assert!(reporter.report(waiting, relay(), None).is_none());
    }

    #[test]
    fn two_resets_in_a_row_both_reach_the_app() {
        let mut reporter = StatusReporter::new();
        let reset = LinkState::Connected {
            resumed: false,
            session_reset: true,
        };
        assert!(reporter.report(reset, relay(), None).is_some());
        assert!(reporter.report(reset, relay(), None).is_some());
    }

    #[test]
    fn the_close_code_rides_along_and_last_seen_is_kept() {
        let mut reporter = StatusReporter::new();
        reporter.saw_machine(Some(42));
        reporter.saw_machine(None);
        let status = reporter
            .report(LinkState::Revoked, None, Some(4003))
            .expect("news");
        assert_eq!(status.close_code, Some(4003));
        assert_eq!(status.last_seen_ms, Some(42));
        assert!(status.is_terminal());
    }
}
