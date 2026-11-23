//! Which sessions the inbox keeps viewed, on a machine whose rows are fed in by hand.

use broski_contract::{
    SessionOrigin, SessionPage, SessionQuery, SessionRef, SessionStatus, SessionSummary,
    MAX_PAGE_LIMIT,
};

use crate::catalog::lists::ListSpec;

use super::holds::MAX_HELD_SESSIONS;
use super::state::State;
use super::tests::unreachable;
use crate::view::ViewEnd;

fn row(index: i64, status: SessionStatus) -> SessionSummary {
    SessionSummary {
        session: SessionRef {
            backend: "pi".to_owned(),
            session_id: format!("s{index}"),
        },
        title: None,
        cwd: Some("/w".to_owned()),
        created_at: None,
        updated_at: index,
        run_started_at: None,
        parent: None,
        model_id: None,
        status,
        origin: SessionOrigin::Broski,
        source: None,
    }
}

/// The machine's inbox list, loaded with `rows`.
fn load(state: &mut State, rows: Vec<SessionSummary>) {
    state.catalog.set_backends(Vec::new());
    let query = SessionQuery {
        cwd: None,
        parent: None,
        search: None,
    };
    let id = state.catalog.lists.create_with(ListSpec {
        backend: "pi".to_owned(),
        query,
        limit: MAX_PAGE_LIMIT as i64,
        capacity: MAX_PAGE_LIMIT,
        keeps_older: true,
    });
    state.catalog.inbox.push(("pi".to_owned(), id));
    let list = state.catalog.lists.get_mut(id).expect("the list");
    let (ask, _) = list.ask(false).expect("a first page");
    list.page(
        &ask,
        SessionPage {
            items: rows,
            next_cursor: None,
        },
    );
}

fn held(state: &State) -> Vec<String> {
    let mut held: Vec<String> = (state.streams.held())
        .into_iter()
        .map(|(_, session)| session.session_id)
        .collect();
    held.sort();
    held
}

fn ids(range: std::ops::RangeInclusive<i64>) -> Vec<String> {
    let mut ids: Vec<String> = range.map(|index| format!("s{index}")).collect();
    ids.sort();
    ids
}

#[tokio::test]
async fn the_newest_waiting_sessions_are_held_until_their_rows_stop_waiting() {
    let machine = unreachable();
    let shared = machine.shared();
    let mut state = shared.lock();
    let bound = MAX_HELD_SESSIONS as i64;
    let mut rows: Vec<SessionSummary> = (1..=bound + 2)
        .map(|index| row(index, SessionStatus::WaitingForUser))
        .collect();
    rows.push(row(bound + 3, SessionStatus::Idle));
    shared.hold_waiting(&mut state);
    assert!(held(&state).is_empty(), "nothing before the rows are in");

    load(&mut state, rows);
    shared.hold_waiting(&mut state);
    assert_eq!(MAX_HELD_SESSIONS, 16);
    assert_eq!(
        held(&state),
        ids(3..=bound + 2),
        "the sixteen newest waiting"
    );

    state
        .catalog
        .lists
        .updated(&row(bound + 2, SessionStatus::Running));
    shared.hold_waiting(&mut state);
    assert_eq!(
        held(&state),
        ids(2..=bound + 1),
        "one stops waiting, the next oldest takes its place"
    );

    let newest = format!("s{}", bound + 1);
    let refused = state
        .streams
        .held()
        .into_iter()
        .find(|(_, session)| session.session_id == newest);
    let (stream, session) = refused.expect("the newest waiting is held");
    let message = "no such session".to_owned();
    state
        .streams
        .get_mut(stream)
        .expect("stream")
        .end(ViewEnd::Refused { message });
    shared.hold_waiting(&mut state);
    let streams_of_refused = state
        .streams
        .held()
        .into_iter()
        .filter(|(_, held)| held == &session);
    assert_eq!(
        streams_of_refused.count(),
        1,
        "a refused session is not attached again"
    );

    for index in 1..=bound + 2 {
        state
            .catalog
            .lists
            .updated(&row(index, SessionStatus::Idle));
    }
    shared.hold_waiting(&mut state);
    assert!(held(&state).is_empty(), "every view let go");
    assert!(
        state.streams.ids().is_empty(),
        "with no screen reading them, they are gone"
    );
}

#[tokio::test]
async fn a_view_the_app_reads_outlives_the_inboxs_hold() {
    let machine = unreachable();
    let session = row(1, SessionStatus::WaitingForUser).session;
    let view = std::sync::Arc::clone(&machine)
        .attach(session)
        .expect("a view");
    let shared = machine.shared();
    let mut state = shared.lock();
    load(&mut state, vec![row(1, SessionStatus::WaitingForUser)]);
    shared.hold_waiting(&mut state);
    assert_eq!(
        state.streams.ids().len(),
        1,
        "the hold shares the app's stream"
    );

    state.catalog.lists.updated(&row(1, SessionStatus::Idle));
    shared.hold_waiting(&mut state);
    assert!(held(&state).is_empty());
    assert_eq!(state.streams.ids().len(), 1, "the app still reads it");
    drop(state);
    drop(view);
    assert!(shared.lock().streams.ids().is_empty());
}
