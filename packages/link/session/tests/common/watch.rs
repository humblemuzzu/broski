pub use broski_link_testkit::WAIT;

use broski_link_session::{
    BridgeStatus, Event, LinkState, MachineRecord, Route, SendFailure, Session, Status,
};
use tokio::time::{timeout_at, Instant};

/// A session and everything it has said so far. Every wait pulls events until what it waits for
/// has been seen or `WAIT` runs out: the events are the synchronisation, never the clock.
pub struct Watch {
    pub session: Session,
    pub statuses: Vec<Status>,
    pub bridge: Vec<String>,
    pub bridge_statuses: Vec<BridgeStatus>,
    pub records: Vec<MachineRecord>,
    pub failures: Vec<(Option<String>, SendFailure)>,
    pub ended: bool,
}

impl Watch {
    pub fn new(session: Session) -> Watch {
        Watch {
            session,
            statuses: Vec::new(),
            bridge: Vec::new(),
            bridge_statuses: Vec::new(),
            records: Vec::new(),
            failures: Vec::new(),
            ended: false,
        }
    }

    /// Pulls events until `done` holds, and panics naming `what` when it never does.
    pub async fn until(&mut self, what: &str, done: impl Fn(&Watch) -> bool) {
        let deadline = Instant::now() + WAIT;
        while !done(self) {
            assert!(
                !self.ended,
                "the session ended while waiting for {what}: {:?}",
                self.statuses
            );
            match timeout_at(deadline, self.session.next_event()).await {
                Ok(Some(event)) => self.record(event),
                Ok(None) => self.ended = true,
                Err(_) => panic!("timed out waiting for {what}; statuses {:?}", self.statuses),
            }
        }
    }

    fn record(&mut self, event: Event) {
        match event {
            Event::Status(status) => self.statuses.push(status),
            Event::Bridge(bytes) => self
                .bridge
                .push(String::from_utf8(bytes).expect("utf8 frame")),
            Event::BridgeStatus(status) => self.bridge_statuses.push(status),
            Event::RecordChanged(record) => self.records.push(record),
            Event::SendFailed { tag, reason } => self.failures.push((tag, reason)),
            Event::Screen(_) | Event::MacDialogs(_) => {}
        }
    }

    /// The first status from index `from` on that `matches` accepts.
    pub async fn status_after(
        &mut self,
        from: usize,
        what: &str,
        matches: impl Fn(&Status) -> bool,
    ) -> Status {
        let found = |watch: &Watch| watch.statuses.iter().skip(from).any(&matches);
        self.until(what, found).await;
        self.statuses
            .iter()
            .skip(from)
            .find(|status| matches(status))
            .cloned()
            .expect("found")
    }

    /// The first `Connected` from index `from` on.
    pub async fn connected_after(&mut self, from: usize) -> Status {
        self.status_after(from, "a connected status", |status| {
            matches!(status.state, LinkState::Connected { .. })
        })
        .await
    }

    pub async fn connected_on(&mut self, from: usize, route: Route) -> Status {
        self.status_after(from, "a connected status on that route", |status| {
            matches!(status.state, LinkState::Connected { .. }) && status.route == Some(route)
        })
        .await
    }

    pub fn mark(&self) -> usize {
        self.statuses.len()
    }

    pub fn send(&self, text: &str) {
        self.session
            .send_bridge(text.as_bytes().to_vec(), Some(text.to_owned()))
            .expect("queued");
    }

    /// Waits until `count` echoes arrived in total.
    pub async fn echoes(&mut self, count: usize) {
        self.until("the echoes", |watch| watch.bridge.len() >= count)
            .await;
    }

    pub async fn round_trip(&mut self, text: &str) {
        self.send(text);
        let expected = format!("echo:{text}");
        self.until("an echo", |watch| watch.bridge.contains(&expected))
            .await;
    }

    /// Reads to the end of the event stream.
    pub async fn end(&mut self) {
        self.until("the end of the events", |watch| watch.ended)
            .await;
    }
}

pub fn resumed(status: &Status) -> Option<bool> {
    match status.state {
        LinkState::Connected { resumed, .. } => Some(resumed),
        _ => None,
    }
}

pub fn session_reset(status: &Status) -> bool {
    matches!(
        status.state,
        LinkState::Connected {
            session_reset: true,
            ..
        }
    )
}
