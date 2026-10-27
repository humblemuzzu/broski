use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::Instant;

/// The bucket for requests that name no `request` group, which is every lock-screen decision.
pub(super) const UNGROUPED: &str = "-";
/// A request nobody answers is dropped from the map after this long. The asker gives up on its own
/// long before, so this only bounds the map.
const PENDING_TTL: Duration = Duration::from_secs(60);

struct Waiting {
    deadline: Instant,
    reply: oneshot::Sender<Option<Value>>,
}

/// The requests the bridge owes an answer for, oldest first inside each group. Answers are matched
/// to the oldest waiter, so two requests in the same group never displace each other.
#[derive(Default)]
pub(super) struct Pending {
    groups: HashMap<String, VecDeque<Waiting>>,
}

impl Pending {
    pub(super) fn new() -> Pending {
        Pending::default()
    }

    pub(super) fn wait(&mut self, group: String, reply: oneshot::Sender<Option<Value>>) {
        self.groups.entry(group).or_default().push_back(Waiting {
            deadline: Instant::now() + PENDING_TTL,
            reply,
        });
    }

    pub(super) fn take(&mut self, group: &str) -> Option<oneshot::Sender<Option<Value>>> {
        let queue = self.groups.get_mut(group)?;
        let waiting = queue.pop_front();
        if queue.is_empty() {
            self.groups.remove(group);
        }
        waiting.map(|waiting| waiting.reply)
    }

    pub(super) fn sweep(&mut self, now: Instant) {
        self.groups.retain(|_, queue| {
            queue.retain(|waiting| waiting.deadline > now);
            !queue.is_empty()
        });
    }

    #[cfg(test)]
    pub(super) fn waiting(&self) -> usize {
        self.groups.values().map(VecDeque::len).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_requests_in_one_group_are_answered_in_order() {
        let mut pending = Pending::new();
        let (first, mut first_answer) = oneshot::channel();
        let (second, mut second_answer) = oneshot::channel();
        pending.wait(UNGROUPED.to_owned(), first);
        pending.wait(UNGROUPED.to_owned(), second);
        assert_eq!(pending.waiting(), 2);

        let oldest = pending.take(UNGROUPED).expect("the oldest waiter answers");
        oldest.send(Some(Value::from(1))).expect("the first answer");
        let next = pending.take(UNGROUPED).expect("the second waiter answers");
        next.send(Some(Value::from(2))).expect("the second answer");
        assert_eq!(
            first_answer.try_recv().expect("first value"),
            Some(Value::from(1))
        );
        assert_eq!(
            second_answer.try_recv().expect("second value"),
            Some(Value::from(2))
        );
        assert!(pending.take(UNGROUPED).is_none());
    }

    #[test]
    fn a_request_past_its_deadline_is_swept_out() {
        let mut pending = Pending::new();
        let (reply, mut answer) = oneshot::channel();
        pending.wait("group".to_owned(), reply);
        pending.sweep(Instant::now() + PENDING_TTL + Duration::from_millis(1));
        assert_eq!(pending.waiting(), 0);
        assert!(matches!(
            answer.try_recv(),
            Err(oneshot::error::TryRecvError::Closed)
        ));
    }
}
