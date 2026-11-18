//! One session this phone views: its place in the bridge's stream, the live state the reducer keeps
//! from the stream's events, and the subscribers it hands changes to (core README §6, contract
//! README §12.2).

use std::sync::Arc;
use std::time::Duration;

use broski_contract::{
    AgentEvent, AttachSync, ClientMessage, EventEnvelope, ServerMessage, SessionAttachRequest,
    SessionCapabilities, SessionRef, SessionSnapshot, StreamPosition,
};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::changes::{self, Delta};
use super::queue::{Live, Take, UpdateQueue};
use super::ViewEnd;
use crate::attach::{AttachRetry, Next};
use crate::inbox::{ask_command, pending_ask, PendingAsk};

mod holds;
mod streams;

pub(crate) use self::streams::Streams;

/// Sessions one phone views at once: the bridge serves a client at most 32 (core README §14).
pub(crate) const MAX_VIEWED_SESSIONS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Not attached on the bridge socket in use; attaches once the bridge is ready, or after the
    /// pause a failed attach set.
    Detached,
    Attaching,
    Attached,
    Ended,
}

pub(crate) struct StreamState {
    session: SessionRef,
    position: Option<StreamPosition>,
    snapshot: SessionSnapshot,
    capabilities: Option<SessionCapabilities>,
    phase: Phase,
    subscribers: Vec<(u64, UpdateQueue)>,
    /// Kept viewed for the inbox, subscribers or not.
    held: bool,
    retry: AttachRetry,
}

/// What the inbox reads from a session this phone views.
pub(crate) struct LiveInfo {
    pub(crate) ask: Option<String>,
    pub(crate) command: Option<String>,
    /// The first pending interaction, while the stream is attached: a detached one's snapshot may
    /// hold an ask that was answered meanwhile.
    pub(crate) pending: Option<PendingAsk>,
    pub(crate) needs_you: bool,
    pub(crate) working: bool,
}

impl StreamState {
    fn new(session: SessionRef) -> StreamState {
        StreamState {
            session,
            position: None,
            snapshot: broski_contract::empty_snapshot(),
            capabilities: None,
            phase: Phase::Detached,
            subscribers: Vec::new(),
            held: false,
            retry: AttachRetry::default(),
        }
    }

    /// Subscribers look again whenever the stream starts or stops following the session live.
    fn set_phase(&mut self, phase: Phase) {
        let was_live = self.phase == Phase::Attached;
        self.phase = phase;
        if was_live != (phase == Phase::Attached) {
            for (_, queue) in &self.subscribers {
                queue.notify.notify_one();
            }
        }
    }

    pub(crate) fn session(&self) -> &SessionRef {
        &self.session
    }

    pub(crate) fn snapshot(&self) -> &SessionSnapshot {
        &self.snapshot
    }

    pub(crate) fn capabilities(&self) -> Option<&SessionCapabilities> {
        self.capabilities.as_ref()
    }

    pub(crate) fn needs_attach(&self) -> bool {
        self.phase == Phase::Detached
    }

    /// The attach to send now: a resume of the position held, so the bridge replays what was missed.
    pub(crate) fn attach_request(&mut self) -> ClientMessage {
        self.set_phase(Phase::Attaching);
        ClientMessage::SessionAttach(SessionAttachRequest {
            request_id: String::new(),
            session: self.session.clone(),
            resume: self.position.clone(),
        })
    }

    /// The bridge socket in use is gone, and this phone's attachment with it; the next socket gets
    /// the whole retry window again.
    pub(crate) fn detached(&mut self) {
        if matches!(self.phase, Phase::Attaching | Phase::Attached) {
            self.set_phase(Phase::Detached);
        }
        self.retry.succeeded();
    }

    pub(crate) fn end(&mut self, reason: ViewEnd) {
        self.phase = Phase::Ended;
        for (_, queue) in &mut self.subscribers {
            queue.end(reason.clone());
        }
    }

    /// The link did not send the attach: it goes again after a pause, until the retry window ends.
    pub(crate) fn not_sent(&mut self, why: String, now: Instant) -> Next {
        if self.phase == Phase::Ended {
            return Next::Nothing;
        }
        match self.retry.failed(now) {
            Some(pause) => self.attach_after(pause),
            None => {
                self.end(ViewEnd::Refused { message: why });
                Next::Nothing
            }
        }
    }

    fn attach_after(&mut self, pause: Duration) -> Next {
        self.set_phase(Phase::Detached);
        Next::AttachAfter(pause)
    }

    /// A refusal that may pass is tried again after a pause that grows, the view keeping its last
    /// snapshot meanwhile; one that will not, or one that goes on past the window, ends the view.
    pub(crate) fn on_attach_answer(&mut self, answer: ServerMessage, now: Instant) -> Next {
        if self.phase == Phase::Ended {
            return Next::Nothing;
        }
        match answer {
            ServerMessage::SessionAttachResult(answer) => {
                self.retry.succeeded();
                self.capabilities = Some(answer.capabilities);
                self.synced(answer.sync)
            }
            ServerMessage::Error(error) => match self.retry.refused(error.error.code, now) {
                Some(pause) => self.attach_after(pause),
                None => {
                    self.end(ViewEnd::Refused {
                        message: error.error.message,
                    });
                    Next::Nothing
                }
            },
            other => {
                self.end(ViewEnd::Refused {
                    message: format!("the bridge answered the attach with {other:?}"),
                });
                Next::Nothing
            }
        }
    }

    fn synced(&mut self, sync: AttachSync) -> Next {
        match sync {
            AttachSync::Replay(replay) => {
                let resumed = StreamPosition {
                    epoch: replay.epoch,
                    seq: replay.after_seq,
                };
                if self.position.as_ref() == Some(&resumed) {
                    self.set_phase(Phase::Attached);
                    return Next::Nothing;
                }
                self.position = None;
                self.attach_again()
            }
            AttachSync::Snapshot(sync) => {
                self.position = Some(StreamPosition {
                    epoch: sync.epoch,
                    seq: sync.last_seq,
                });
                self.snapshot = sync.snapshot;
                self.set_phase(Phase::Attached);
                self.fan_out(Delta::Reset);
                Next::Nothing
            }
            AttachSync::Replaced(replaced) => self.follow(replaced.session),
        }
    }

    /// The conversation goes on as `session`: a new stream, attached without a resume.
    fn follow(&mut self, session: SessionRef) -> Next {
        self.session = session;
        self.position = None;
        self.attach_again()
    }

    /// The machine sends an attach only for a detached stream.
    fn attach_again(&mut self) -> Next {
        self.set_phase(Phase::Detached);
        Next::Attach
    }

    pub(crate) fn on_event(&mut self, envelope: EventEnvelope) -> Next {
        let (Phase::Attached, Some(position)) = (self.phase, self.position.as_mut()) else {
            return Next::Nothing;
        };
        if envelope.seq <= position.seq {
            return Next::Nothing;
        }
        if envelope.seq != position.seq + 1 {
            return self.attach_again();
        }
        position.seq = envelope.seq;
        let replacement = match &envelope.event {
            AgentEvent::SessionReplaced(replaced) => Some(replaced.session.clone()),
            _ => None,
        };
        for delta in changes::apply(&mut self.snapshot, envelope.at, envelope.event) {
            self.fan_out(delta);
        }
        match replacement {
            Some(session) => self.follow(session),
            None => Next::Nothing,
        }
    }

    fn fan_out(&mut self, delta: Delta) {
        if let Some(((_, last), others)) = self.subscribers.split_last_mut() {
            for (_, queue) in others {
                queue.push(delta.clone());
            }
            last.push(delta);
        }
    }

    fn has(&self, subscriber: u64) -> bool {
        self.subscribers.iter().any(|(id, _)| *id == subscriber)
    }

    fn take(&mut self, subscriber: u64, now: Instant) -> Option<(Take, Arc<Notify>)> {
        let live = self.capabilities.as_ref().map(|capabilities| Live {
            session: &self.session,
            capabilities,
            snapshot: &self.snapshot,
            attached: self.phase == Phase::Attached,
        });
        let (_, queue) = self
            .subscribers
            .iter_mut()
            .find(|(id, _)| *id == subscriber)?;
        Some((queue.take(now, live), Arc::clone(&queue.notify)))
    }

    pub(crate) fn live_info(&self) -> Option<LiveInfo> {
        if self.phase == Phase::Ended {
            return None;
        }
        let answerable = self.capabilities.as_ref()?.answer;
        let snapshot = &self.snapshot;
        let first = snapshot.interactions.first();
        let attached = self.phase == Phase::Attached;
        Some(LiveInfo {
            ask: first.map(|ask| ask.title.clone()),
            command: first.and_then(ask_command),
            pending: first
                .filter(|_| attached)
                .map(|ask| pending_ask(ask, answerable)),
            needs_you: !snapshot.interactions.is_empty(),
            working: snapshot.run.is_some()
                || snapshot.compaction.is_some()
                || snapshot.retry.is_some(),
        })
    }
}
