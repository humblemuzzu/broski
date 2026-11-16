//! A stream whose attach the bridge refuses, or the link does not send: tried again after a pause
//! that grows while the view keeps its state and says it is not live, and ended only by a refusal
//! that will not pass or one that lasts past the retry window.

use std::time::Duration;

use broski_contract::{
    AttachSync, ErrorResponse, ProtocolError, ProtocolErrorCode, ReplaySync, ServerMessage,
    SessionRef, StreamPosition,
};
use tokio::time::Instant;

use super::queue::Take;
use super::stream::Streams;
use super::stream_tests::{answer, attached, notice, resume_of, session};
use super::{SessionUpdate, ViewEnd};
use crate::attach::{Next, RETRY_WINDOW};

fn refusal(code: ProtocolErrorCode) -> ServerMessage {
    ServerMessage::Error(ErrorResponse {
        request_id: Some("1".to_owned()),
        error: ProtocolError {
            code,
            message: format!("refused: {code:?}"),
        },
    })
}

fn update(streams: &mut Streams, subscriber: u64) -> Option<SessionUpdate> {
    match streams.take(subscriber, Instant::now()).0 {
        Take::Update(update) => Some(update),
        _ => None,
    }
}

#[test]
fn a_passing_refusal_is_tried_again_after_a_growing_pause_and_the_view_keeps_its_state() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, subscriber) = attached(&mut streams, &of);
    let view = streams.get_mut(stream).expect("stream");
    view.on_event(notice(1, &of));
    view.detached();
    assert_eq!(
        update(&mut streams, subscriber),
        Some(SessionUpdate::Live { live: false }),
        "the UI learns the state it holds is not live"
    );

    let now = Instant::now();
    let mut pauses = Vec::new();
    for code in [
        ProtocolErrorCode::UnknownBackend,
        ProtocolErrorCode::Internal,
        ProtocolErrorCode::UnknownSession,
        ProtocolErrorCode::NotAttached,
    ] {
        resume_of(&mut streams, stream);
        let view = streams.get_mut(stream).expect("stream");
        match view.on_attach_answer(refusal(code), now) {
            Next::AttachAfter(pause) => pauses.push(pause.as_secs()),
            other => panic!("{code:?} is tried again, not {other:?}"),
        }
    }
    assert_eq!(pauses, [1, 2, 4, 8]);
    assert!(
        !matches!(
            update(&mut streams, subscriber),
            Some(SessionUpdate::Ended { .. })
        ),
        "nothing ended"
    );
    let held = StreamPosition {
        epoch: "e1".to_owned(),
        seq: 1,
    };
    assert_eq!(resume_of(&mut streams, stream), Some(held));
    let resumed = AttachSync::Replay(ReplaySync {
        epoch: "e1".to_owned(),
        after_seq: 1,
    });
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(view.on_attach_answer(answer(resumed), now), Next::Nothing);
    assert_eq!(
        update(&mut streams, subscriber),
        Some(SessionUpdate::Live { live: true })
    );

    resume_of_after_gap(&mut streams, stream, &of);
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(
        view.on_attach_answer(refusal(ProtocolErrorCode::Internal), now),
        Next::AttachAfter(Duration::from_secs(1)),
        "an attach that succeeded starts the pauses over"
    );
}

/// A gap, and the attach it sends.
fn resume_of_after_gap(streams: &mut Streams, stream: u64, of: &SessionRef) {
    let view = streams.get_mut(stream).expect("stream");
    assert_eq!(view.on_event(notice(9, of)), Next::Attach);
    resume_of(streams, stream);
}

#[test]
fn a_refusal_that_lasts_past_the_window_or_will_not_pass_ends_the_view() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, subscriber) = attached(&mut streams, &of);
    let start = Instant::now();
    resume_of_after_gap(&mut streams, stream, &of);
    let view = streams.get_mut(stream).expect("stream");
    assert!(matches!(
        view.on_attach_answer(refusal(ProtocolErrorCode::Internal), start),
        Next::AttachAfter(_)
    ));
    resume_of(&mut streams, stream);
    let view = streams.get_mut(stream).expect("stream");
    let late = start + RETRY_WINDOW;
    assert_eq!(
        view.on_attach_answer(refusal(ProtocolErrorCode::Internal), late),
        Next::Nothing
    );
    assert_eq!(
        update(&mut streams, subscriber),
        Some(SessionUpdate::Ended {
            reason: ViewEnd::Refused {
                message: "refused: Internal".to_owned()
            }
        })
    );

    let (stream, subscriber) = attached(&mut streams, &session("t"));
    resume_of_after_gap(&mut streams, stream, &session("t"));
    let view = streams.get_mut(stream).expect("stream");
    let refused = refusal(ProtocolErrorCode::InvalidMessage);
    assert_eq!(view.on_attach_answer(refused, start), Next::Nothing);
    assert!(matches!(
        update(&mut streams, subscriber),
        Some(SessionUpdate::Ended { .. })
    ));
}

#[test]
fn an_attach_the_link_did_not_send_goes_again_after_a_pause() {
    let mut streams = Streams::default();
    let of = session("s");
    let (stream, _) = attached(&mut streams, &of);
    resume_of_after_gap(&mut streams, stream, &of);
    let view = streams.get_mut(stream).expect("stream");
    let now = Instant::now();
    assert_eq!(
        view.not_sent("queue full".to_owned(), now),
        Next::AttachAfter(Duration::from_secs(1))
    );
    assert!(view.needs_attach(), "the pause ends in an attach");
    view.attach_request();
    assert_eq!(
        view.not_sent("queue full".to_owned(), now + RETRY_WINDOW),
        Next::Nothing
    );
    assert!(!view.needs_attach(), "ended");
}
