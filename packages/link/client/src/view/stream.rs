//! One session this phone views: its place in the bridge's stream, the live state the reducer keeps
//! from the stream's events, and the subscribers it hands changes to (core README §6, contract
//! README §12.2).

use std::collections::HashMap;
use std::sync::Arc;

use broski_contract::{
    AgentEvent, AttachSync, ClientMessage, EventEnvelope, ProtocolErrorCode, ServerMessage,
    SessionAttachRequest, SessionCapabilities, SessionDetachRequest, SessionRef, SessionSnapshot,
    StreamPosition,
};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::changes::{self, Delta};
use super::queue::{Live, Take, UpdateQueue};
use super::ViewEnd;
use crate::attach::Next;
use crate::error::ClientError;

/// Sessions one phone views at once: the bridge serves a client at most 32 (core README §14).
pub(crate) const MAX_VIEWED_SESSIONS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Not attached on the bridge socket in use; attaches once the bridge is ready.
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
}

/// What the inbox reads from a session this phone views.
pub(crate) struct LiveInfo {
    pub(crate) ask: Option<String>,
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
        self.phase = Phase::Attaching;
        ClientMessage::SessionAttach(SessionAttachRequest {
            request_id: String::new(),
            session: self.session.clone(),
            resume: self.position.clone(),
        })
    }

    /// The bridge socket in use is gone, and this phone's attachment with it.
    pub(crate) fn detached(&mut self) {
        if matches!(self.phase, Phase::Attaching | Phase::Attached) {
            self.phase = Phase::Detached;
        }
    }

    pub(crate) fn end(&mut self, reason: ViewEnd) {
        self.phase = Phase::Ended;
        for (_, queue) in &mut self.subscribers {
            queue.end(reason.clone());
        }
    }

    pub(crate) fn on_attach_answer(&mut self, answer: ServerMessage) -> Next {
        match answer {
            ServerMessage::SessionAttachResult(answer) => {
                self.capabilities = Some(answer.capabilities);
                self.synced(answer.sync)
            }
            ServerMessage::Error(error) if error.error.code == ProtocolErrorCode::RateLimited => {
                self.phase = Phase::Detached;
                Next::AttachLater
            }
            ServerMessage::Error(error) => {
                self.end(ViewEnd::Refused {
                    message: error.error.message,
                });
                Next::Nothing
            }
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
                    self.phase = Phase::Attached;
                    return Next::Nothing;
                }
                self.position = None;
                Next::Attach
            }
            AttachSync::Snapshot(sync) => {
                self.position = Some(StreamPosition {
                    epoch: sync.epoch,
                    seq: sync.last_seq,
                });
                self.snapshot = sync.snapshot;
                self.phase = Phase::Attached;
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
        self.phase = Phase::Detached;
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
            self.phase = Phase::Detached;
            return Next::Attach;
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
        });
        let (_, queue) = self
            .subscribers
            .iter_mut()
            .find(|(id, _)| *id == subscriber)?;
        Some((queue.take(now, live), Arc::clone(&queue.notify)))
    }

    pub(crate) fn live_info(&self) -> Option<LiveInfo> {
        self.capabilities.as_ref()?;
        let snapshot = &self.snapshot;
        Some(LiveInfo {
            ask: snapshot.interactions.first().map(|ask| ask.title.clone()),
            needs_you: !snapshot.interactions.is_empty(),
            working: snapshot.run.is_some()
                || snapshot.compaction.is_some()
                || snapshot.retry.is_some(),
        })
    }
}

/// Every session this phone views. A view knows its subscriber id only, so a stream that goes on as
/// a session another stream already views can hand its subscribers over.
#[derive(Default)]
pub(crate) struct Streams {
    next: u64,
    streams: HashMap<u64, StreamState>,
}

impl Streams {
    /// A new subscriber of `session`: of the stream already viewing it, or of a new one, which the
    /// caller then attaches.
    pub(crate) fn subscribe(&mut self, session: &SessionRef) -> Result<(u64, u64), ClientError> {
        let existing = self.viewing(session);
        let stream = match existing {
            Some(stream) => stream,
            None if self.streams.len() >= MAX_VIEWED_SESSIONS => {
                return Err(ClientError::InvalidRequest {
                    detail: format!("a phone views at most {MAX_VIEWED_SESSIONS} sessions"),
                })
            }
            None => {
                self.next += 1;
                self.streams
                    .insert(self.next, StreamState::new(session.clone()));
                self.next
            }
        };
        self.next += 1;
        let subscriber = self.next;
        if let Some(state) = self.streams.get_mut(&stream) {
            state.subscribers.push((subscriber, UpdateQueue::new()));
        }
        Ok((stream, subscriber))
    }

    /// The subscriber leaves; the detach to send when it was the stream's last.
    pub(crate) fn unsubscribe(&mut self, subscriber: u64) -> Option<ClientMessage> {
        let stream = self.of_subscriber(subscriber)?;
        let state = self.streams.get_mut(&stream)?;
        state.subscribers.retain(|(id, queue)| {
            let leaving = *id == subscriber;
            if leaving {
                queue.notify.notify_one();
            }
            !leaving
        });
        if !state.subscribers.is_empty() {
            return None;
        }
        let state = self.streams.remove(&stream)?;
        matches!(state.phase, Phase::Attaching | Phase::Attached).then(|| {
            ClientMessage::SessionDetach(SessionDetachRequest {
                request_id: String::new(),
                session: state.session,
            })
        })
    }

    pub(crate) fn get_mut(&mut self, stream: u64) -> Option<&mut StreamState> {
        self.streams.get_mut(&stream)
    }

    fn of_subscriber(&self, subscriber: u64) -> Option<u64> {
        self.streams
            .iter()
            .find(|(_, state)| state.has(subscriber))
            .map(|(id, _)| *id)
    }

    /// The stream `subscriber` reads.
    pub(crate) fn read(&self, subscriber: u64) -> Option<&StreamState> {
        self.streams.get(&self.of_subscriber(subscriber)?)
    }

    /// The subscriber's next update, and what to wait on when there is none yet.
    pub(crate) fn take(&mut self, subscriber: u64, now: Instant) -> (Take, Arc<Notify>) {
        let stream = self.of_subscriber(subscriber);
        stream
            .and_then(|stream| self.streams.get_mut(&stream))
            .and_then(|state| state.take(subscriber, now))
            .unwrap_or_else(|| (Take::Finished, Arc::new(Notify::new())))
    }

    /// After `stream` went on as another session: when another stream already views that session,
    /// it takes `stream`'s subscribers, each starting again from its snapshot, and `stream` goes.
    /// True when it did, so `stream` needs no attach of its own.
    pub(crate) fn merge(&mut self, stream: u64) -> bool {
        let Some(session) = self.streams.get(&stream).map(|state| state.session.clone()) else {
            return false;
        };
        let other = self.streams.iter().find(|(id, state)| {
            **id != stream && state.phase != Phase::Ended && state.session == session
        });
        let Some(other) = other.map(|(id, _)| *id) else {
            return false;
        };
        let moved = self.streams.remove(&stream).map(|state| state.subscribers);
        if let Some(target) = self.streams.get_mut(&other) {
            for (subscriber, mut queue) in moved.into_iter().flatten() {
                queue.reset();
                target.subscribers.push((subscriber, queue));
            }
        }
        true
    }

    fn viewing(&self, session: &SessionRef) -> Option<u64> {
        self.streams
            .iter()
            .find(|(_, state)| state.phase != Phase::Ended && &state.session == session)
            .map(|(id, _)| *id)
    }

    /// The stream an event of `session` belongs to.
    pub(crate) fn of_session(&mut self, session: &SessionRef) -> Option<(u64, &mut StreamState)> {
        let id = self.viewing(session)?;
        self.streams.get_mut(&id).map(|state| (id, state))
    }

    pub(crate) fn ids(&self) -> Vec<u64> {
        self.streams.keys().copied().collect()
    }

    pub(crate) fn live_info(&self, session: &SessionRef) -> Option<LiveInfo> {
        self.viewing(session)
            .and_then(|id| self.streams.get(&id))
            .and_then(StreamState::live_info)
    }

    pub(crate) fn each(&mut self, mut act: impl FnMut(&mut StreamState)) {
        self.streams.values_mut().for_each(&mut act);
    }
}
