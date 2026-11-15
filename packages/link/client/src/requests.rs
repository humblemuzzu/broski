//! Requests on their way to the bridge and back, by the id the client gave each.

use std::collections::BTreeMap;
use std::time::Duration;

use broski_contract::{ServerMessage, REQUEST_DEADLINE_MS};
use tokio::sync::oneshot;
use tokio::time::Instant;

use crate::error::ClientError;

/// Requests from callers that may wait for answers at once. The bridge serves 60 a second in bursts
/// of 150 per connection (core README §10); a phone with this many unanswered is stuck, not busy.
pub(crate) const MAX_PENDING_REQUESTS: usize = 256;

/// Beyond the bridge's own deadline, for the link to carry the request and its answer.
const LINK_GRACE: Duration = Duration::from_secs(15);

/// When a caller stops waiting: the bridge answers every request within `REQUEST_DEADLINE_MS`
/// (core README §11), so a request still unanswered after it and the grace has lost its link.
pub(crate) fn deadline() -> Instant {
    Instant::now() + Duration::from_millis(REQUEST_DEADLINE_MS as u64) + LINK_GRACE
}

pub(crate) type Answer = Result<ServerMessage, ClientError>;

/// Who an answer goes to.
pub(crate) enum Waiter {
    Caller(oneshot::Sender<Answer>),
    Hello,
    Attach(u64),
    TermAttach(u64),
}

struct Pending {
    waiter: Waiter,
    /// The frame, while it waits for the bridge to agree on the protocol.
    held: Option<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct Requests {
    next: u64,
    pending: BTreeMap<u64, Pending>,
}

impl Requests {
    pub(crate) fn mint(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    pub(crate) fn callers(&self) -> usize {
        self.pending
            .values()
            .filter(|pending| matches!(pending.waiter, Waiter::Caller(_)))
            .count()
    }

    pub(crate) fn has_held(&self) -> bool {
        self.pending.values().any(|pending| pending.held.is_some())
    }

    pub(crate) fn insert(&mut self, id: u64, waiter: Waiter, held: Option<Vec<u8>>) {
        self.pending.insert(id, Pending { waiter, held });
    }

    pub(crate) fn remove(&mut self, id: u64) -> Option<Waiter> {
        self.pending.remove(&id).map(|pending| pending.waiter)
    }

    /// The waiter for the answer `id` names; ids this client did not mint, or no longer waits on,
    /// name nobody.
    pub(crate) fn answered(&mut self, id: &str) -> Option<Waiter> {
        let id: u64 = id.parse().ok()?;
        match self.pending.get(&id) {
            Some(pending) if pending.held.is_none() => self.remove(id),
            _ => None,
        }
    }

    /// Every held frame in the order its request was made, each now counted as sent.
    pub(crate) fn release_held(&mut self) -> Vec<(u64, Vec<u8>)> {
        self.pending
            .iter_mut()
            .filter_map(|(id, pending)| pending.held.take().map(|frame| (*id, frame)))
            .collect()
    }

    /// The bridge socket the sent requests went out on is gone, and their answers with it.
    pub(crate) fn drain_sent(&mut self) -> Vec<Waiter> {
        let sent: Vec<u64> = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.held.is_none())
            .map(|(id, _)| *id)
            .collect();
        sent.into_iter().filter_map(|id| self.remove(id)).collect()
    }

    pub(crate) fn drain_held(&mut self) -> Vec<Waiter> {
        let held: Vec<u64> = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.held.is_some())
            .map(|(id, _)| *id)
            .collect();
        held.into_iter().filter_map(|id| self.remove(id)).collect()
    }

    pub(crate) fn drain(&mut self) -> Vec<Waiter> {
        std::mem::take(&mut self.pending)
            .into_values()
            .map(|pending| pending.waiter)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caller(requests: &mut Requests, held: bool) -> (u64, oneshot::Receiver<Answer>) {
        let (sender, receiver) = oneshot::channel();
        let id = requests.mint();
        requests.insert(id, Waiter::Caller(sender), held.then(|| vec![id as u8]));
        (id, receiver)
    }

    #[test]
    fn an_answer_reaches_its_request_once_and_unknown_ids_reach_nobody() {
        let mut requests = Requests::default();
        let (first, _a) = caller(&mut requests, false);
        let (second, _b) = caller(&mut requests, false);
        assert!(requests.answered(&second.to_string()).is_some());
        assert!(requests.answered(&second.to_string()).is_none());
        for stranger in ["", "r1", "-1", "18446744073709551616", "99"] {
            assert!(requests.answered(stranger).is_none(), "{stranger}");
        }
        assert!(requests.answered(&first.to_string()).is_some());
        assert_eq!(requests.callers(), 0);
    }

    #[test]
    fn a_held_request_is_not_answered_until_it_was_sent() {
        let mut requests = Requests::default();
        let (id, _receiver) = caller(&mut requests, true);
        assert!(requests.answered(&id.to_string()).is_none());
        assert_eq!(requests.release_held(), vec![(id, vec![id as u8])]);
        assert!(!requests.has_held());
        assert!(requests.answered(&id.to_string()).is_some());
    }

    #[test]
    fn held_frames_go_out_in_the_order_their_requests_were_made() {
        let mut requests = Requests::default();
        let ids: Vec<u64> = (0..5)
            .map(|index| caller(&mut requests, index % 2 == 0).0)
            .collect();
        let released: Vec<u64> = requests
            .release_held()
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        assert_eq!(released, vec![ids[0], ids[2], ids[4]]);
    }

    #[test]
    fn a_lost_socket_fails_what_was_sent_and_keeps_what_was_held() {
        let mut requests = Requests::default();
        let (_sent, mut sent_answer) = caller(&mut requests, false);
        let (held, _held_answer) = caller(&mut requests, true);
        requests.insert(requests.next + 1, Waiter::Hello, None);
        let lost = requests.drain_sent();
        assert_eq!(lost.len(), 2);
        for waiter in lost {
            if let Waiter::Caller(sender) = waiter {
                let _ = sender.send(Err(ClientError::LinkReset));
            }
        }
        assert_eq!(sent_answer.try_recv(), Ok(Err(ClientError::LinkReset)));
        assert!(requests.has_held());
        assert_eq!(requests.release_held()[0].0, held);
    }

    #[test]
    fn only_callers_count_against_the_bound() {
        let mut requests = Requests::default();
        for _ in 0..3 {
            caller(&mut requests, false);
        }
        let id = requests.mint();
        requests.insert(id, Waiter::Attach(1), None);
        assert_eq!(requests.callers(), 3);
    }
}
