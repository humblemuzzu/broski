//! Every session this phone views, by stream, and the subscribers reading each.

use std::collections::HashMap;
use std::sync::Arc;

use broski_contract::{ClientMessage, SessionDetachRequest, SessionRef};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::{LiveInfo, Phase, StreamState, MAX_VIEWED_SESSIONS};
use crate::error::ClientError;
use crate::view::queue::{Take, UpdateQueue};

/// Every session this phone views. A view knows its subscriber id only, so a stream that goes on as
/// a session another stream already views can hand its subscribers over.
#[derive(Default)]
pub(crate) struct Streams {
    next: u64,
    pub(super) streams: HashMap<u64, StreamState>,
}

impl Streams {
    /// A new subscriber of `session`: of the stream already viewing it, or of a new one, which the
    /// caller then attaches.
    pub(crate) fn subscribe(&mut self, session: &SessionRef) -> Result<(u64, u64), ClientError> {
        let stream = match self.viewing(session) {
            Some(stream) => stream,
            None => self.open(session)?,
        };
        self.next += 1;
        let subscriber = self.next;
        if let Some(state) = self.streams.get_mut(&stream) {
            state.subscribers.push((subscriber, UpdateQueue::new()));
        }
        Ok((stream, subscriber))
    }

    /// A new stream of `session`, within the bound on viewed sessions.
    pub(super) fn open(&mut self, session: &SessionRef) -> Result<u64, ClientError> {
        if self.streams.len() >= MAX_VIEWED_SESSIONS {
            return Err(ClientError::InvalidRequest {
                detail: format!("a phone views at most {MAX_VIEWED_SESSIONS} sessions"),
            });
        }
        self.next += 1;
        self.streams
            .insert(self.next, StreamState::new(session.clone()));
        Ok(self.next)
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
        if !state.subscribers.is_empty() || state.held {
            return None;
        }
        self.remove(stream)
    }

    /// Drops a stream nothing reads any more; the detach to send when it was attached.
    pub(super) fn remove(&mut self, stream: u64) -> Option<ClientMessage> {
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
        let moved = self.streams.remove(&stream);
        if let (Some(target), Some(moved)) = (self.streams.get_mut(&other), moved) {
            target.held |= moved.held;
            for (subscriber, mut queue) in moved.subscribers {
                queue.reset();
                target.subscribers.push((subscriber, queue));
            }
        }
        true
    }

    pub(super) fn viewing(&self, session: &SessionRef) -> Option<u64> {
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

    /// What every view knows live, by its session, in the views' order: what the inbox shows of the
    /// sessions viewed.
    pub(crate) fn live_fingerprint(&self) -> Vec<(SessionRef, Option<LiveInfo>)> {
        let mut ids: Vec<u64> = self.streams.keys().copied().collect();
        ids.sort_unstable();
        ids.iter()
            .filter_map(|id| self.streams.get(id))
            .map(|stream| (stream.session.clone(), stream.live_info()))
            .collect()
    }

    pub(crate) fn each(&mut self, mut act: impl FnMut(&mut StreamState)) {
        self.streams.values_mut().for_each(&mut act);
    }
}
