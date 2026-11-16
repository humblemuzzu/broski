//! A stream's place in the bridge's stream: attach, resume, gaps and replacements (core README §6,
//! contract README §12.2).

use broski_contract::{
    AgentEvent, AttachSync, BackendId, ClientMessage, ConfirmRequest, EventEnvelope, Interaction,
    InteractionRequest, NoticeEvent, NoticeLevel, ReplacedSync, ReplaySync, ServerMessage,
    SessionAttachResponse, SessionCapabilities, SessionRef, SessionReplacedEvent, SnapshotSync,
    StreamPosition,
};
use tokio::time::Instant;

use super::queue::Take;
use super::stream::{Streams, MAX_VIEWED_SESSIONS};
use super::SessionUpdate;
use crate::attach::Next;

fn session(id: &str) -> SessionRef {
    SessionRef {
        backend: BackendId::Pi,
        session_id: id.to_owned(),
    }
}

fn answer(sync: AttachSync) -> ServerMessage {
    ServerMessage::SessionAttachResult(SessionAttachResponse {
        request_id: "1".to_owned(),
        capabilities: SessionCapabilities {
            controllable: true,
            compact: false,
            cancel_queued: false,
            answer: true,
        },
        sync,
    })
}

fn snapshot_sync(epoch: &str, last_seq: i64) -> AttachSync {
    AttachSync::Snapshot(SnapshotSync {
        epoch: epoch.to_owned(),
        last_seq,
        snapshot: broski_contract::empty_snapshot(),
    })
}

fn notice(seq: i64, of: &SessionRef) -> EventEnvelope {
    EventEnvelope {
        session: of.clone(),
        seq,
        at: seq,
        event: AgentEvent::Notice(NoticeEvent {
            level: NoticeLevel::Info,
            text: format!("event {seq}"),
        }),
        native: None,
    }
}

/// The resume of the attach the machine sends next: it sends one only for a stream that
/// `needs_attach`.
fn resume_of(streams: &mut Streams, stream: u64) -> Option<StreamPosition> {
    let view = streams.get_mut(stream).expect("stream");
    assert!(
        view.needs_attach(),
        "the machine would send no attach for this stream"
    );
    match view.attach_request() {
        ClientMessage::SessionAttach(request) => request.resume,
        other => panic!("not an attach: {other:?}"),
    }
}

/// A stream attached at `epoch`, seq 0, with one subscriber that took its first snapshot.
fn attached(streams: &mut Streams, of: &SessionRef) -> (u64, u64) {
    let (stream, subscriber) = streams.subscribe(of).expect("subscribed");
    assert_eq!(
        resume_of(streams, stream),
        None,
        "a first attach resumes nothing"
    );
    let next = streams
        .get_mut(stream)
        .expect("stream")
        .on_attach_answer(answer(snapshot_sync("e1", 0)));
    assert_eq!(next, Next::Nothing);
    assert!(matches!(
        streams.take(subscriber, Instant::now()).0,
        Take::Update(SessionUpdate::Reset { .. })
    ));
    (stream, subscriber)
}

#[test]
fn a_gap_attaches_again_from_the_last_event_held_and_repeats_are_dropped() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, _) = attached(&mut streams, &of);
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(view.on_event(notice(1, &of)), Next::Nothing);
    assert_eq!(view.on_event(notice(1, &of)), Next::Nothing, "a repeat");
    assert_eq!(view.on_event(notice(3, &of)), Next::Attach, "a gap");
    let held = StreamPosition {
        epoch: "e1".to_owned(),
        seq: 1,
    };
    assert_eq!(resume_of(&mut streams, stream), Some(held));

    let view = streams.get_mut(stream).expect("stream");
    view.on_event(notice(2, &of));
    let resumed = AttachSync::Replay(ReplaySync {
        epoch: "e1".to_owned(),
        after_seq: 1,
    });
    assert_eq!(view.on_attach_answer(answer(resumed)), Next::Nothing);
    assert_eq!(view.on_event(notice(2, &of)), Next::Nothing);
    assert_eq!(
        view.on_event(notice(3, &of)),
        Next::Nothing,
        "the event sent before the answer came again in the replay, and only once"
    );
}

#[test]
fn a_replay_of_a_position_this_phone_does_not_hold_starts_over() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, _) = attached(&mut streams, &of);
    let view = streams.get_mut(stream).expect("stream");
    view.on_event(notice(1, &of));
    assert_eq!(view.on_event(notice(3, &of)), Next::Attach, "a gap");
    resume_of(&mut streams, stream);
    let other = AttachSync::Replay(ReplaySync {
        epoch: "e1".to_owned(),
        after_seq: 5,
    });
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(view.on_attach_answer(answer(other)), Next::Attach);
    assert_eq!(resume_of(&mut streams, stream), None);
}

#[test]
fn a_replacement_is_followed_without_a_resume_live_or_at_attach() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, subscriber) = attached(&mut streams, &of);
    let replaced = EventEnvelope {
        event: AgentEvent::SessionReplaced(SessionReplacedEvent {
            session: session("next"),
        }),
        ..notice(1, &of)
    };
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(view.on_event(replaced), Next::Attach);
    assert_eq!(view.session(), &session("next"));
    assert_eq!(resume_of(&mut streams, stream), None);

    let moved = AttachSync::Replaced(ReplacedSync {
        epoch: "e2".to_owned(),
        session: session("last"),
    });
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(view.on_attach_answer(answer(moved)), Next::Attach);
    assert_eq!(resume_of(&mut streams, stream), None);
    let view = streams.get_mut(stream).expect("stream");
    view.on_attach_answer(answer(snapshot_sync("e3", 4)));
    let Take::Update(SessionUpdate::Reset { session, .. }) =
        streams.take(subscriber, Instant::now()).0
    else {
        panic!("the successor's snapshot");
    };
    assert_eq!(session, self::session("last"));
}

#[test]
fn a_stream_that_goes_on_as_a_session_already_viewed_hands_over_its_subscribers() {
    let mut streams = Streams::default();
    let (first, follower) = attached(&mut streams, &session("old"));
    let (second, _) = attached(&mut streams, &session("new"));
    let replaced = EventEnvelope {
        event: AgentEvent::SessionReplaced(SessionReplacedEvent {
            session: session("new"),
        }),
        ..notice(1, &session("old"))
    };
    let view = streams.get_mut(first).expect("stream");
    assert_eq!(view.on_event(replaced), Next::Attach);
    assert!(streams.merge(first));
    assert!(streams.get_mut(first).is_none());
    assert!(streams.get_mut(second).is_some());
    assert_eq!(
        streams.read(follower).map(|view| view.session().clone()),
        Some(session("new"))
    );
    assert!(matches!(
        streams.take(follower, Instant::now()).0,
        Take::Update(SessionUpdate::Reset { .. })
    ));
}

#[test]
fn views_of_one_session_share_its_stream_within_the_bridges_bound() {
    let mut streams = Streams::default();
    let (stream, first) = attached(&mut streams, &session("s"));
    let (same, second) = streams.subscribe(&session("s")).expect("shared");
    assert_eq!(same, stream);
    assert!(
        streams.unsubscribe(first).is_none(),
        "another view still reads it"
    );
    match streams.unsubscribe(second) {
        Some(ClientMessage::SessionDetach(detach)) => assert_eq!(detach.session, session("s")),
        other => panic!("the last view detaches: {other:?}"),
    }
    let subscribers: Vec<u64> = (0..MAX_VIEWED_SESSIONS)
        .map(|index| {
            streams
                .subscribe(&session(&index.to_string()))
                .expect("within the bound")
                .1
        })
        .collect();
    assert!(streams.subscribe(&session("one more")).is_err());
    assert!(
        streams.subscribe(&session("0")).is_ok(),
        "a session already viewed takes no new place"
    );
    assert!(
        streams.unsubscribe(subscribers[1]).is_none(),
        "a stream never attached has nothing to detach"
    );
}

#[test]
fn an_ask_is_offered_to_the_inbox_only_while_its_stream_is_attached() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, _) = streams.subscribe(&of).expect("subscribed");
    resume_of(&mut streams, stream);
    let mut snapshot = broski_contract::empty_snapshot();
    snapshot.interactions.push(Interaction {
        id: "i1".to_owned(),
        run_id: None,
        created_at: 0,
        expires_at: None,
        title: "Go on?".to_owned(),
        body: None,
        blocks_run: false,
        origin: None,
        request: InteractionRequest::Confirm(ConfirmRequest { url: None }),
    });
    let sync = AttachSync::Snapshot(SnapshotSync {
        epoch: "e1".to_owned(),
        last_seq: 0,
        snapshot,
    });
    let view = streams.get_mut(stream).expect("stream");
    view.on_attach_answer(answer(sync));
    let live = streams.live_info(&of).expect("live");
    assert_eq!(
        live.pending
            .map(|pending| pending.interaction_id)
            .as_deref(),
        Some("i1")
    );

    streams.get_mut(stream).expect("stream").detached();
    let live = streams.live_info(&of).expect("live");
    assert!(live.needs_you, "the row still needs the person");
    assert_eq!(live.ask.as_deref(), Some("Go on?"));
    assert!(
        live.pending.is_none(),
        "but nothing is answered from a snapshot the link left"
    );
}
