//! A terminal view's place in the output stream (contract README §20.2): every byte once, in order,
//! across reattaches, and a reset exactly where the bridge no longer held what was missed.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use broski_contract::{
    ClientMessage, Rejected, Rejection, RejectionCode, ServerMessage, TermAttachResponse,
    TermAttachResult, TermExitedMessage, TermOutputMessage, TerminalAttached, TerminalStatus,
    TerminalSummary, MAX_TERMINAL_OUTPUT_BYTES,
};

use super::state::{TakeOutput, Terminals};
use super::TerminalUpdate;
use crate::attach::Next;

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
    view.on_attach_answer(attached(0, b"hello", TerminalStatus::Running));
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
    view.on_attach_answer(attached(5, b" again", TerminalStatus::Running));
    assert_eq!(update(&mut terminals, key), bytes(b" again", false));

    terminals.get_mut(key).expect("view").detached();
    assert_eq!(since(&mut terminals, key), Some(11));
    let view = terminals.get_mut(key).expect("view");
    view.on_attach_answer(attached(40, b"newest", TerminalStatus::Running));
    assert_eq!(update(&mut terminals, key), bytes(b"newest", true));
}

#[test]
fn output_while_attaching_is_left_to_the_replay_and_out_of_order_output_attaches_again() {
    let (mut terminals, key) = running();
    terminals.get_mut(key).expect("view").detached();
    since(&mut terminals, key);
    let view = terminals.get_mut(key).expect("view");
    assert_eq!(view.on_output(output(5, b"x")), Next::Nothing);
    view.on_attach_answer(attached(5, b"x", TerminalStatus::Running));
    assert_eq!(update(&mut terminals, key), bytes(b"x", false));
    let view = terminals.get_mut(key).expect("view");
    assert_eq!(view.on_output(output(9, b"skipped ahead")), Next::Attach);
    assert_eq!(since(&mut terminals, key), Some(6));
}

#[test]
fn more_waiting_output_than_the_bridge_replays_asks_again_from_what_the_ui_has() {
    let (mut terminals, key) = running();
    let chunk = vec![b'a'; 64 * 1024];
    let mut seq = 5;
    let view = terminals.get_mut(key).expect("view");
    while seq - 5 <= MAX_TERMINAL_OUTPUT_BYTES as i64 {
        if view.on_output(output(seq, &chunk)) == Next::Attach {
            break;
        }
        seq += chunk.len() as i64;
    }
    assert_eq!(since(&mut terminals, key), Some(5));
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
        .on_attach_answer(refused);
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
