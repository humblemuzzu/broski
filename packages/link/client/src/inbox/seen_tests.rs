use broski_contract::{SessionOrigin, SessionSummary};

use super::*;
use crate::view::stream::LiveInfo;

const MACHINE: &str = "m";
const NOW: i64 = 1_800_000_000_000;

fn named(id: &str) -> SessionRef {
    SessionRef {
        backend: "pi".to_owned(),
        session_id: id.to_owned(),
    }
}

fn session() -> SessionRef {
    SessionRef {
        backend: "pi".to_owned(),
        session_id: "s".to_owned(),
    }
}

fn source(status: SessionStatus, updated_at: i64, live: Option<LiveInfo>) -> InboxSource {
    let row = SessionSummary {
        session: session(),
        title: None,
        cwd: None,
        created_at: None,
        updated_at,
        run_started_at: None,
        parent: None,
        model_id: None,
        status,
        origin: SessionOrigin::Broski,
        source: None,
    };
    InboxSource {
        row,
        live,
        pinned: false,
    }
}

fn live(working: bool, needs_you: bool) -> LiveInfo {
    LiveInfo {
        ask: None,
        command: None,
        pending: None,
        needs_you,
        working,
        run_started_at: None,
    }
}

fn marker(seen: &Seen) -> Option<i64> {
    match seen.get(MACHINE, &session()) {
        Mark::SeenAt(seen_at) => Some(seen_at),
        Mark::Unseen | Mark::Unread => None,
    }
}

fn unread_in(seen: &Seen) -> Vec<(String, String, String)> {
    (seen.state().unread.into_iter())
        .map(|unread| {
            let SessionRef {
                backend,
                session_id,
            } = unread.session;
            (unread.machine_id, backend, session_id)
        })
        .collect()
}

#[test]
fn a_session_whose_row_is_current_is_marked_at_its_updated_at() {
    let mut seen = Seen::default();
    let idle = source(SessionStatus::Idle, 10, Some(live(false, false)));
    seen.see(MACHINE, &session(), Some(&idle));
    assert_eq!(marker(&seen), Some(10));
    let running = source(SessionStatus::Running, 20, Some(live(true, false)));
    seen.see(MACHINE, &session(), Some(&running));
    assert_eq!(marker(&seen), Some(20), "a run the person watches");
}

#[test]
fn a_marker_never_moves_back() {
    let mut seen = Seen::default();
    seen.see(
        MACHINE,
        &session(),
        Some(&source(SessionStatus::Idle, 20, None)),
    );
    seen.see(
        MACHINE,
        &session(),
        Some(&source(SessionStatus::Idle, 10, None)),
    );
    assert_eq!(marker(&seen), Some(20));
}

#[test]
fn a_session_not_listed_yet_is_marked_when_its_row_comes_in() {
    let mut seen = Seen::default();
    seen.see(MACHINE, &session(), None);
    assert_eq!(marker(&seen), None);
    seen.resolve(MACHINE, &[source(SessionStatus::Idle, 10, None)]);
    assert_eq!(marker(&seen), Some(10));
    seen.resolve(MACHINE, &[source(SessionStatus::Idle, 30, None)]);
    assert_eq!(marker(&seen), Some(10), "marked once");
}

#[test]
fn a_row_still_running_after_the_view_saw_the_run_end_waits_for_its_update() {
    for status in [SessionStatus::Running, SessionStatus::WaitingForUser] {
        let mut seen = Seen::default();
        let stale = source(status, 10, Some(live(false, false)));
        seen.see(MACHINE, &session(), Some(&stale));
        assert_eq!(marker(&seen), None, "{status:?}");
        seen.resolve(MACHINE, &[source(status, 10, None)]);
        assert_eq!(marker(&seen), None, "still {status:?}");
        seen.resolve(MACHINE, &[source(SessionStatus::Idle, 25, None)]);
        assert_eq!(marker(&seen), Some(25), "the run's own update is seen");
    }
}

#[test]
fn markers_of_one_session_id_under_many_backends_come_out_in_backend_order() {
    let backends = [
        "acp",
        "claude-code",
        "codex",
        "cursor",
        "gemini",
        "grok",
        "opencode",
        "pi",
    ];
    let mut seen = Seen::default();
    for backend in backends.iter().rev() {
        let session = SessionRef {
            backend: (*backend).to_owned(),
            session_id: "s".to_owned(),
        };
        seen.mark(MACHINE, &session, 1);
    }
    let order: Vec<String> = (seen.state().markers.into_iter())
        .map(|marker| marker.session.backend)
        .collect();
    assert_eq!(order, backends);
}

#[test]
fn forgetting_a_machine_drops_its_waiting_marks() {
    let mut seen = Seen::default();
    seen.see(MACHINE, &session(), None);
    seen.forget_machine(MACHINE);
    seen.resolve(MACHINE, &[source(SessionStatus::Idle, 10, None)]);
    assert_eq!(marker(&seen), None);
}

#[test]
fn marking_a_seen_session_unread_drops_its_marker_until_it_is_seen_again() {
    let mut seen = Seen::default();
    let idle = source(SessionStatus::Idle, 10, None);
    seen.see(MACHINE, &session(), Some(&idle));
    seen.changed = false;

    seen.unsee(MACHINE, &session());
    assert_eq!(seen.get(MACHINE, &session()), Mark::Unread);
    assert!(seen.changed);
    assert!(seen.state().markers.is_empty());
    assert_eq!(
        unread_in(&seen),
        [(MACHINE.into(), "pi".into(), "s".into())]
    );
    seen.changed = false;
    seen.unsee(MACHINE, &session());
    assert!(!seen.changed, "already unread");

    seen.see(MACHINE, &session(), Some(&idle));
    assert_eq!(seen.get(MACHINE, &session()), Mark::SeenAt(10));
    assert!(seen.changed);
    assert!(seen.state().unread.is_empty());
}

#[test]
fn seeing_a_session_whose_row_waits_still_clears_its_unread_mark() {
    let mut seen = Seen::default();
    seen.unsee(MACHINE, &session());
    seen.see(MACHINE, &session(), None);
    assert_eq!(seen.get(MACHINE, &session()), Mark::Unseen);
    seen.resolve(MACHINE, &[source(SessionStatus::Idle, 10, None)]);
    assert_eq!(seen.get(MACHINE, &session()), Mark::SeenAt(10));
}

#[test]
fn marking_unread_cancels_a_mark_waiting_for_its_row() {
    let mut seen = Seen::default();
    seen.see(MACHINE, &session(), None);
    seen.unsee(MACHINE, &session());
    seen.resolve(MACHINE, &[source(SessionStatus::Idle, 10, None)]);
    assert_eq!(seen.get(MACHINE, &session()), Mark::Unread);
}

#[test]
fn a_session_seen_as_its_cached_row_is_marked_there_and_waits_for_no_row() {
    let mut seen = Seen::default();
    seen.see(MACHINE, &session(), None);
    seen.unsee(MACHINE, &session());
    seen.see_cached(MACHINE, &session(), 10);
    assert_eq!(seen.get(MACHINE, &session()), Mark::SeenAt(10));
    assert!(seen.state().unread.is_empty());
    seen.resolve(MACHINE, &[source(SessionStatus::Idle, 30, None)]);
    assert_eq!(marker(&seen), Some(10), "what happened since is still done");
}

#[test]
fn marking_everything_seen_clears_unread_marks() {
    let mut seen = Seen::default();
    seen.unsee(MACHINE, &session());
    seen.mark_at(MACHINE, &session(), 10);
    assert_eq!(seen.get(MACHINE, &session()), Mark::SeenAt(10));
    assert!(seen.state().unread.is_empty());
}

#[test]
fn unread_marks_survive_a_restore_and_win_over_a_stored_marker() {
    let mut seen = Seen::default();
    seen.unsee(MACHINE, &session());
    let mut stored = seen.state();
    stored.markers.push(SeenMarker {
        machine_id: MACHINE.into(),
        session: session(),
        seen_at: 10,
    });
    let mut restored = Seen::default();
    restored.restore(stored);
    assert_eq!(restored.get(MACHINE, &session()), Mark::Unread);
    assert!(restored.state().markers.is_empty());
    assert_eq!(restored.state().unread, seen.state().unread);
}

#[test]
fn a_first_read_keeps_unread_marks_of_listed_sessions_and_drops_the_rest() {
    let gone = SessionRef {
        backend: "pi".to_owned(),
        session_id: "gone".to_owned(),
    };
    let mut seen = Seen::default();
    seen.restore(SeenState {
        read_machines: vec![MACHINE.into()],
        ..SeenState::default()
    });
    seen.unsee(MACHINE, &session());
    seen.unsee(MACHINE, &gone);
    seen.first_read(MACHINE, &[source(SessionStatus::Idle, 10, None)], NOW);
    assert_eq!(seen.get(MACHINE, &session()), Mark::Unread);
    assert_eq!(seen.get(MACHINE, &gone), Mark::Unseen);
}

#[test]
fn a_machine_first_read_after_a_session_was_marked_unread_leaves_it_unread() {
    let mut seen = Seen::default();
    seen.unsee(MACHINE, &session());
    seen.first_read(MACHINE, &[source(SessionStatus::Idle, 10, None)], NOW);
    assert_eq!(seen.get(MACHINE, &session()), Mark::Unread);
    assert!(seen.state().markers.is_empty());
}

#[test]
fn a_first_pairing_counts_every_older_session_seen_even_one_no_page_has_loaded() {
    let mut seen = Seen::default();
    seen.first_read(
        MACHINE,
        &[source(SessionStatus::Idle, NOW - 100, None)],
        NOW,
    );
    assert_eq!(
        seen.get(MACHINE, &named("deep")),
        Mark::SeenAt(NOW - 100),
        "a session older than the first read, loaded later by scrolling or a search"
    );
    let history = seen.state().histories;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].through, NOW - 100);

    let mut restarted = Seen::default();
    restarted.restore(seen.state());
    restarted.first_read(MACHINE, &[], NOW + 10);
    assert_eq!(
        restarted.get(MACHINE, &named("deep")),
        Mark::SeenAt(NOW - 100)
    );
}

#[test]
fn a_restart_keeps_the_markers_of_sessions_no_page_has_loaded_and_drops_the_ones_that_change_nothing(
) {
    let mut seen = Seen::default();
    seen.first_read(
        MACHINE,
        &[source(SessionStatus::Idle, NOW - 100, None)],
        NOW,
    );
    seen.mark_at(MACHINE, &named("earlier"), NOW - 50);
    seen.mark_at(MACHINE, &named("later"), NOW - 40);
    let mut restarted = Seen::default();
    restarted.restore(seen.state());
    restarted.first_read(MACHINE, &[], NOW + DONE_WINDOW_MS - 45);
    let kept: Vec<String> = (restarted.state().markers.into_iter())
        .map(|marker| marker.session.session_id)
        .collect();
    assert_eq!(
        kept,
        ["later"],
        "one past the window goes, one still able to matter stays"
    );
}

#[test]
fn a_machine_read_before_histories_were_kept_takes_its_newest_marker_as_its_history() {
    let mut seen = Seen::default();
    seen.restore(SeenState {
        read_machines: vec![MACHINE.into()],
        markers: vec![
            SeenMarker {
                machine_id: MACHINE.into(),
                session: named("a"),
                seen_at: NOW - 30,
            },
            SeenMarker {
                machine_id: MACHINE.into(),
                session: named("b"),
                seen_at: NOW - 20,
            },
        ],
        ..SeenState::default()
    });
    seen.first_read(MACHINE, &[], NOW);
    assert_eq!(seen.get(MACHINE, &named("deep")), Mark::SeenAt(NOW - 20));
    assert!(
        seen.state().markers.is_empty(),
        "the history covers both markers"
    );
}

#[test]
fn forgetting_a_machine_drops_its_unread_marks() {
    let other = "other";
    let mut seen = Seen::default();
    seen.unsee(MACHINE, &session());
    seen.unsee(other, &session());
    seen.changed = false;
    seen.forget_machine(MACHINE);
    assert!(seen.changed);
    assert_eq!(seen.get(MACHINE, &session()), Mark::Unseen);
    assert_eq!(unread_in(&seen), [(other.into(), "pi".into(), "s".into())]);
}

#[test]
fn unread_marks_come_out_by_machine_backend_and_session() {
    let mut seen = Seen::default();
    for (machine, backend, session_id) in [
        ("m-2", "pi", "a"),
        ("m-1", "pi", "b"),
        ("m-1", "pi", "a"),
        ("m-1", "claude-code", "z"),
    ] {
        let session = SessionRef {
            backend: backend.to_owned(),
            session_id: session_id.to_owned(),
        };
        seen.unsee(machine, &session);
    }
    let order: Vec<(String, String, String)> = unread_in(&seen);
    let expected = [
        ("m-1", "claude-code", "z"),
        ("m-1", "pi", "a"),
        ("m-1", "pi", "b"),
        ("m-2", "pi", "a"),
    ]
    .map(|(machine, backend, session_id)| {
        (
            machine.to_owned(),
            backend.to_owned(),
            session_id.to_owned(),
        )
    });
    assert_eq!(order, expected);
}
