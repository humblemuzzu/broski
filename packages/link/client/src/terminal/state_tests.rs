//! A terminal view's place in the output stream (contract README §20.2): every byte once, in order,
//! across reattaches, and a reset exactly where the bridge no longer held what was missed.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use broski_contract::{
    ClientMessage, ErrorResponse, ProtocolError, ProtocolErrorCode, Rejected, Rejection,
    RejectionCode, ServerMessage, TermAttachResponse, TermAttachResult, TermExitedMessage,
    TermOutputMessage, TerminalAttached, TerminalStatus, TerminalSummary,
    MAX_TERMINAL_OUTPUT_BYTES,
};
use tokio::time::Instant;

use super::state::{TakeOutput, Terminals};
use super::TerminalUpdate;
use crate::attach::{Next, RETRY_WINDOW};

fn summary(status: TerminalStatus) -> TerminalSummary {
    TerminalSummary {
        id: "t".to_owned(),
        cwd: "/w".to_owned(),
        cols: 80,
        rows: 24,
        created_at: 0,
        status,
        exit_code: None,
        signal: None,
    }
}

fn attached(seq: i64, data: &[u8], status: TerminalStatus) -> ServerMessage {
    ServerMessage::TermAttachResult(TermAttachResponse {
        request_id: "1".to_owned(),
        result: TermAttachResult::Accepted(TerminalAttached {
            terminal: summary(status),
            seq,
            data: STANDARD.encode(data),
        }),
    })
}

fn output(seq: i64, data: &[u8]) -> TermOutputMessage {
    TermOutputMessage {
        id: "t".to_owned(),
        seq,
        data: STANDARD.encode(data),
    }
}

/// The `since` of the attach the machine sends next: it sends one only for a view that
/// `needs_attach`.
fn since(terminals: &mut Terminals, key: u64) -> Option<i64> {
    let view = terminals.get_mut(key).expect("view");
    assert!(
        view.needs_attach(),
        "the machine would send no attach for this view"
    );
    match view.attach_request() {
        ClientMessage::TermAttach(request) => request.since,
        other => panic!("not a terminal attach: {other:?}"),
    }
}

fn update(terminals: &mut Terminals, key: u64) -> TerminalUpdate {
    match terminals.take(key) {
        TakeOutput::Update(update) => update,
        _ => panic!("an update is due"),
    }
}

fn bytes(data: &[u8], reset: bool) -> TerminalUpdate {
    TerminalUpdate::Output {
        data: data.to_vec(),
        reset,
    }
}

/// A view attached to a running terminal whose output so far is `hello`.
fn running() -> (Terminals, u64) {
    let mut terminals = Terminals::default();
    let key = terminals.open("t".to_owned()).expect("opened");
    assert_eq!(
        since(&mut terminals, key),
        None,
        "the first attach asks for everything"
    );
    let view = terminals.get_mut(key).expect("view");
    view.on_attach_answer(
        attached(0, b"hello", TerminalStatus::Running),
        Instant::now(),
    );
    assert_eq!(update(&mut terminals, key), bytes(b"hello", true));
    (terminals, key)
}

#[test]
fn output_follows_the_replay_in_order() {
    let (mut terminals, key) = running();
    let view = terminals.get_mut(key).expect("view");
    assert_eq!(view.on_output(output(5, b" wor")), Next::Nothing);
    assert_eq!(view.on_output(output(9, b"ld")), Next::Nothing);
    assert_eq!(update(&mut terminals, key), bytes(b" world", false));
    assert!(matches!(terminals.take(key), TakeOutput::Wait(_)));
}

#[test]
fn a_reattach_gets_only_what_was_missed_or_starts_over_past_a_gap() {
    let (mut terminals, key) = running();
    terminals.get_mut(key).expect("view").detached();
    assert_eq!(since(&mut terminals, key), Some(5));
    let view = terminals.get_mut(key).expect("view");
    view.on_attach_answer(
        attached(5, b" again", TerminalStatus::Running),
        Instant::now(),
    );
    assert_eq!(update(&mut terminals, key), bytes(b" again", false));

    terminals.get_mut(key).expect("view").detached();
    assert_eq!(since(&mut terminals, key), Some(11));
    let view = terminals.get_mut(key).expect("view");
    view.on_attach_answer(
        attached(40, b"newest", TerminalStatus::Running),
        Instant::now(),
    );
    assert_eq!(update(&mut terminals, key), bytes(b"newest", true));
}

#[test]
fn output_while_attaching_is_left_to_the_replay_and_out_of_order_output_attaches_again() {
    let (mut terminals, key) = running();
    terminals.get_mut(key).expect("view").detached();
    since(&mut terminals, key);
    let view = terminals.get_mut(key).expect("view");
    assert_eq!(view.on_output(output(5, b"x")), Next::Nothing);
    view.on_attach_answer(attached(5, b"x", TerminalStatus::Running), Instant::now());
    assert_eq!(update(&mut terminals, key), bytes(b"x", false));
    let view = terminals.get_mut(key).expect("view");
    assert_eq!(view.on_output(output(9, b"skipped ahead")), Next::Attach);
    assert_eq!(since(&mut terminals, key), Some(6));
}

/// The terminal's output from offset `from` on, one distinct byte per offset (modulo a prime), so
/// what a view keeps shows where it started.
fn stream(from: usize, len: usize) -> Vec<u8> {
    (from..from + len)
        .map(|offset| (offset % 251) as u8)
        .collect()
}

/// The update is a reset with exactly the newest `MAX_TERMINAL_OUTPUT_BYTES` of the stream up to
/// `end` (compared without printing half a megabyte).
fn assert_newest_after_reset(update: TerminalUpdate, end: usize) {
    let TerminalUpdate::Output { data, reset } = update else {
        panic!("output is due: {update:?}");
    };
    assert!(reset, "the UI clears its emulator first");
    assert_eq!(data.len(), MAX_TERMINAL_OUTPUT_BYTES);
    assert!(data == stream(end - MAX_TERMINAL_OUTPUT_BYTES, MAX_TERMINAL_OUTPUT_BYTES));
}

#[test]
fn more_waiting_output_than_the_bridge_replays_keeps_the_newest_with_a_reset_and_asks_for_nothing()
{
    let (mut terminals, key) = running();
    let written = 3 * MAX_TERMINAL_OUTPUT_BYTES + 1000;
    let view = terminals.get_mut(key).expect("view");
    let mut offset = 5;
    while offset < written {
        let len = (64 * 1024).min(written - offset);
        let frame = output(offset as i64, &stream(offset, len));
        assert_eq!(view.on_output(frame), Next::Nothing);
        assert!(!view.needs_attach(), "the bridge is not asked again");
        offset += len;
    }
    assert_newest_after_reset(update(&mut terminals, key), written);

    let view = terminals.get_mut(key).expect("view");
    let next = output(written as i64, b"more");
    assert_eq!(view.on_output(next), Next::Nothing, "still in step");
    assert_eq!(update(&mut terminals, key), bytes(b"more", false));
}

#[test]
fn a_replay_that_joins_a_nearly_full_queue_keeps_the_newest_too() {
    let (mut terminals, key) = running();
    let held = MAX_TERMINAL_OUTPUT_BYTES - 100;
    let view = terminals.get_mut(key).expect("view");
    view.on_output(output(5, &stream(5, held)));
    let received = 5 + held;
    view.detached();
    assert_eq!(since(&mut terminals, key), Some(received as i64));
    let view = terminals.get_mut(key).expect("view");
    let replay = attached(
        received as i64,
        &stream(received, 300),
        TerminalStatus::Running,
    );
    view.on_attach_answer(replay, Instant::now());
    assert_newest_after_reset(update(&mut terminals, key), received + 300);
}

#[test]
fn the_exit_comes_after_the_last_output_and_ends_the_view() {
    let (mut terminals, key) = running();
    let view = terminals.get_mut(key).expect("view");
    view.on_output(output(5, b" bye"));
    view.on_exited(TermExitedMessage {
        id: "t".to_owned(),
        exit_code: Some(0),
        signal: None,
    });
    assert_eq!(update(&mut terminals, key), bytes(b" bye", false));
    assert_eq!(
        update(&mut terminals, key),
        TerminalUpdate::Exited {
            exit_code: Some(0),
            signal: None
        }
    );
    assert!(matches!(terminals.take(key), TakeOutput::Finished));
    assert!(!terminals.get_mut(key).expect("view").needs_attach());
}

#[test]
fn a_refused_attach_fails_the_view() {
    let mut terminals = Terminals::default();
    let key = terminals.open("t".to_owned()).expect("opened");
    since(&mut terminals, key);
    let refused = ServerMessage::TermAttachResult(TermAttachResponse {
        request_id: "1".to_owned(),
        result: TermAttachResult::Rejected(Rejected {
            rejection: Rejection {
                code: RejectionCode::NotFound,
                message: "no such terminal".to_owned(),
            },
        }),
    });
    terminals
        .get_mut(key)
        .expect("view")
        .on_attach_answer(refused, Instant::now());
    assert_eq!(
        update(&mut terminals, key),
        TerminalUpdate::Failed {
            message: "no such terminal".to_owned()
        }
    );
}

#[test]
fn opening_a_terminal_again_ends_the_view_before() {
    let mut terminals = Terminals::default();
    let first = terminals.open("t".to_owned()).expect("opened");
    let second = terminals.open("t".to_owned()).expect("opened again");
    assert!(matches!(terminals.take(first), TakeOutput::Finished));
    assert!(terminals.close(first).is_none());
    assert!(terminals.get_mut(second).is_some());
}

#[test]
fn a_passing_refusal_attaches_again_from_the_last_byte_and_a_lasting_one_fails_the_view() {
    let (mut terminals, key) = running();
    let view = terminals.get_mut(key).expect("view");
    view.detached();
    let refused = |code| {
        ServerMessage::Error(ErrorResponse {
            request_id: Some("1".to_owned()),
            error: ProtocolError {
                code,
                message: "not now".to_owned(),
            },
        })
    };
    let start = Instant::now();
    assert_eq!(since(&mut terminals, key), Some(5));
    let view = terminals.get_mut(key).expect("view");
    assert!(matches!(
        view.on_attach_answer(refused(ProtocolErrorCode::UnknownBackend), start),
        Next::AttachAfter(_)
    ));
    assert!(
        matches!(terminals.take(key), TakeOutput::Wait(_)),
        "not failed"
    );
    assert_eq!(since(&mut terminals, key), Some(5), "from the last byte");
    let view = terminals.get_mut(key).expect("view");
    let late = start + RETRY_WINDOW;
    let answer = view.on_attach_answer(refused(ProtocolErrorCode::Internal), late);
    assert_eq!(answer, Next::Nothing);
    assert_eq!(
        update(&mut terminals, key),
        TerminalUpdate::Failed {
            message: "not now".to_owned()
        }
    );
}
