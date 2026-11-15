use std::collections::VecDeque;

use broski_link_core::proto;
use broski_link_core::Error as LinkError;

/// Bytes the outbound queue holds before it refuses a send.
///
/// The phone's own budget, inside the link's ceiling (`Config.max_unacked_bytes` 16 MiB,
/// `max_message` 32 MiB). A message that fits here can still be refused on the far side: the
/// daemon drops a bridge message over 8 MiB (`LINK_MAX_MESSAGE_BYTES`), which is why a refusal is
/// reported with its tag instead of being assumed impossible.
pub const OUTBOUND_QUEUE_MAX: usize = 8 * 1024 * 1024;

/// Why the session did not send a message.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SendFailure {
    /// The outbound queue is at its byte bound.
    #[error("the outbound queue is full")]
    QueueFull,
    /// Larger than the queue bound, so it could never be carried.
    #[error("the message is larger than the outbound queue")]
    TooLarge,
    /// The link refused this message; the ones behind it still go out.
    #[error("the link refused the message")]
    Rejected,
    /// The machine started a new session, so everything queued for the old one is gone.
    #[error("the machine started a new session")]
    SessionReset,
    /// The session is over (revoked or closed).
    #[error("the session is over")]
    Closed,
}

struct Queued {
    stream: u32,
    bytes: Vec<u8>,
    tag: Option<String>,
}

/// The session's outbound messages, in order, bounded in bytes.
///
/// A message the link cannot take yet stays at the head and is retried on every pump (an ACK
/// frees the window), so a burst survives backpressure; nothing behind it overtakes it. While no
/// handshake has completed nothing leaves at all: a message handed to a detached link would sit in
/// its session, which a new session drops without a word, while this queue reports what it drops.
#[derive(Default)]
pub(crate) struct OutboundQueue {
    queued: VecDeque<Queued>,
    bytes: usize,
    ready: bool,
    closed: bool,
}

impl OutboundQueue {
    pub(crate) fn push(
        &mut self,
        stream: u32,
        bytes: Vec<u8>,
        tag: Option<String>,
    ) -> Result<(), SendFailure> {
        if self.closed {
            return Err(SendFailure::Closed);
        }
        if bytes.len() > OUTBOUND_QUEUE_MAX {
            return Err(SendFailure::TooLarge);
        }
        if self.bytes + bytes.len() > OUTBOUND_QUEUE_MAX {
            return Err(SendFailure::QueueFull);
        }
        self.bytes += bytes.len();
        self.queued.push_back(Queued { stream, bytes, tag });
        Ok(())
    }

    /// Puts the link's own control messages ahead of a bridge backlog. They are a few hundred
    /// bytes, one per kind per connect, so they are never refused.
    pub(crate) fn push_front(&mut self, stream: u32, bytes: Vec<u8>) {
        self.bytes += bytes.len();
        self.queued.push_front(Queued {
            stream,
            bytes,
            tag: None,
        });
    }

    pub(crate) fn set_ready(&mut self, ready: bool) {
        self.ready = ready;
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.queued.len()
    }

    /// Sends what it can from the front and stops at the first message the link will not take
    /// yet. Returns the tags of the messages the link refused outright.
    pub(crate) fn pump(
        &mut self,
        mut send: impl FnMut(u32, &[u8]) -> Result<(), LinkError>,
    ) -> Vec<Option<String>> {
        let mut rejected = Vec::new();
        while self.ready {
            let Some(head) = self.queued.front() else {
                break;
            };
            match send(head.stream, &head.bytes) {
                Ok(()) => {
                    self.release();
                }
                Err(error) if waits(&error) => break,
                Err(_) => rejected.push(self.release().tag),
            }
        }
        rejected
    }

    /// Forgets everything queued for a session that no longer exists and returns one tag per
    /// dropped message, so the next session is never fed stale frames.
    pub(crate) fn reset(&mut self) -> Vec<Option<String>> {
        self.bytes = 0;
        self.queued.drain(..).map(|queued| queued.tag).collect()
    }

    /// The session is over: what is queued is dropped and every later push refused.
    pub(crate) fn close(&mut self) -> Vec<Option<String>> {
        self.closed = true;
        self.ready = false;
        self.reset()
    }

    fn release(&mut self) -> Queued {
        let queued = self
            .queued
            .pop_front()
            .expect("pump releases the head it sent");
        self.bytes -= queued.bytes.len();
        queued
    }
}

/// Backpressure and a link with no session yet leave the message waiting at the head.
fn waits(error: &LinkError) -> bool {
    matches!(
        error,
        LinkError::Proto(proto::Error::Backpressure { .. })
            | LinkError::NoSession
            | LinkError::NotConnected
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A link that delivers what it is handed, pushes back, is not up yet, or refuses one message.
    #[derive(Default)]
    struct FakeLink {
        delivered: Vec<(u32, String)>,
        window_closed: bool,
        not_ready: bool,
        poison: bool,
    }

    impl FakeLink {
        fn send(&mut self, stream: u32, bytes: &[u8]) -> Result<(), LinkError> {
            if std::mem::take(&mut self.poison) {
                return Err(LinkError::Closed);
            }
            if self.not_ready {
                return Err(LinkError::NoSession);
            }
            if self.window_closed {
                return Err(LinkError::Proto(proto::Error::Backpressure {
                    pending: 1,
                    limit: 1,
                }));
            }
            let text = String::from_utf8(bytes.to_vec()).expect("utf8");
            self.delivered.push((stream, text));
            Ok(())
        }

        fn texts(&self) -> Vec<&str> {
            self.delivered
                .iter()
                .map(|(_, text)| text.as_str())
                .collect()
        }
    }

    fn pump(queue: &mut OutboundQueue, link: &mut FakeLink) -> Vec<Option<String>> {
        queue.pump(|stream, bytes| link.send(stream, bytes))
    }

    fn ready() -> OutboundQueue {
        let mut queue = OutboundQueue::default();
        queue.set_ready(true);
        queue
    }

    #[test]
    fn a_closed_window_keeps_every_message_in_order_until_it_opens() {
        let (mut queue, mut link) = (ready(), FakeLink::default());
        link.window_closed = true;
        for text in ["one", "two", "three"] {
            queue.push(1, text.into(), None).expect("queued");
            assert!(pump(&mut queue, &mut link).is_empty(), "nothing was shed");
        }
        assert!(link.delivered.is_empty());
        assert_eq!(queue.len(), 3);

        link.window_closed = false;
        pump(&mut queue, &mut link);
        assert_eq!(link.texts(), ["one", "two", "three"]);
        assert_eq!(queue.bytes, 0);
    }

    #[test]
    fn a_message_sent_while_the_window_is_closed_waits_behind_the_others() {
        let (mut queue, mut link) = (ready(), FakeLink::default());
        link.window_closed = true;
        queue.push(1, "first".into(), None).expect("queued");
        queue.push(1, "second".into(), None).expect("queued");
        pump(&mut queue, &mut link);
        link.window_closed = false;
        queue.push(1, "third".into(), None).expect("queued");
        pump(&mut queue, &mut link);
        assert_eq!(link.texts(), ["first", "second", "third"]);
    }

    #[test]
    fn nothing_leaves_before_a_session_is_ready() {
        let (mut queue, mut link) = (OutboundQueue::default(), FakeLink::default());
        queue.push(1, "early".into(), None).expect("queued");
        pump(&mut queue, &mut link);
        assert!(link.delivered.is_empty());
        queue.set_ready(true);
        pump(&mut queue, &mut link);
        assert_eq!(link.texts(), ["early"]);
    }

    #[test]
    fn a_full_queue_refuses_the_newest_send() {
        let mut queue = ready();
        queue
            .push(1, vec![0; OUTBOUND_QUEUE_MAX], None)
            .expect("exactly the bound fits");
        assert_eq!(
            queue.push(1, b"one byte too many".to_vec(), None),
            Err(SendFailure::QueueFull)
        );
        assert_eq!(queue.len(), 1);
    }

    #[test]
    fn a_message_larger_than_the_queue_could_ever_hold_is_refused_at_once() {
        let mut queue = ready();
        assert_eq!(
            queue.push(1, vec![0; OUTBOUND_QUEUE_MAX + 1], Some("req_4".into())),
            Err(SendFailure::TooLarge)
        );
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn a_refused_message_is_dropped_alone_with_its_tag_not_as_a_barrier() {
        let (mut queue, mut link) = (ready(), FakeLink::default());
        link.poison = true;
        queue
            .push(1, "poisoned".into(), Some("req_9".into()))
            .expect("queued");
        queue.push(1, "after".into(), None).expect("queued");
        assert_eq!(pump(&mut queue, &mut link), [Some("req_9".to_owned())]);
        assert_eq!(link.texts(), ["after"]);
        assert_eq!(queue.bytes, 0);
    }

    #[test]
    fn a_link_that_is_not_up_yet_holds_messages_instead_of_refusing_them() {
        let (mut queue, mut link) = (ready(), FakeLink::default());
        link.not_ready = true;
        queue.push(1, "waits".into(), None).expect("queued");
        assert!(pump(&mut queue, &mut link).is_empty());
        assert_eq!(queue.len(), 1);
        link.not_ready = false;
        pump(&mut queue, &mut link);
        assert_eq!(link.texts(), ["waits"]);
    }

    #[test]
    fn control_goes_first_and_a_reset_reports_every_dropped_message() {
        let (mut queue, mut link) = (OutboundQueue::default(), FakeLink::default());
        queue
            .push(1, "aa".into(), Some("a".into()))
            .expect("queued");
        queue.push(1, "bbb".into(), None).expect("queued");
        queue.push_front(0, "hello".into());
        assert_eq!(queue.bytes, 10);
        assert_eq!(queue.reset(), [None, Some("a".to_owned()), None]);
        assert_eq!(queue.bytes, 0);
        assert!(queue.reset().is_empty(), "an empty reset reports nothing");

        queue.push(1, "bridge".into(), None).expect("queued");
        queue.push_front(0, "hello".into());
        queue.set_ready(true);
        pump(&mut queue, &mut link);
        assert_eq!(link.delivered, [(0, "hello".into()), (1, "bridge".into())]);
    }
}
