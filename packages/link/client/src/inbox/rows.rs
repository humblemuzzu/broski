//! One inbox row from what a machine knows of a session, or from the cache the app restored.

use std::time::{SystemTime, UNIX_EPOCH};

use broski_contract::{SessionStatus, SessionSummary};

use super::cache::CachedRow;
use super::seen::Mark;
use super::{InboxRow, InboxState};
use crate::machine::InboxSource;
use crate::view::stream::LiveInfo;

/// Sessions older than this settle as `Idle` even with no marker, so old history never piles up
/// in `Done`; one the person marked unread is `Done` however old.
pub(crate) const DONE_WINDOW_MS: i64 = 24 * 60 * 60 * 1_000;

pub(super) struct MachineName {
    pub(super) id: String,
    pub(super) name: String,
    /// Every inbox list of the machine has its first page.
    pub(super) loaded: bool,
}

pub(super) fn live_row(
    machine: &MachineName,
    source: InboxSource,
    mark: Mark,
    now_ms: i64,
) -> InboxRow {
    let InboxSource { row, live, .. } = source;
    let state = state_of(&row, live.as_ref(), mark, now_ms);
    let active = matches!(state, InboxState::NeedsYou | InboxState::Working);
    let (ask, command, pending, live_started_at) = match live {
        Some(live) => (live.ask, live.command, live.pending, live.run_started_at),
        None => (None, None, None, None),
    };
    let run_started_at = active
        .then(|| live_started_at.or(row.run_started_at))
        .flatten();
    let stale = !machine.loaded;
    InboxRow {
        machine_id: machine.id.clone(),
        machine_name: machine.name.clone(),
        title: row.title.map(|title| title.text),
        session: row.session,
        cwd: row.cwd,
        state,
        updated_at: row.updated_at,
        run_started_at,
        ask,
        command,
        pending: if stale { None } else { pending },
        cached: stale,
    }
}

/// A row as last known. Needs you and working stay as they were (nothing newer is known); done
/// and idle follow what the person has seen since.
pub(super) fn cached_row(cached: &CachedRow, mark: Mark, now_ms: i64) -> InboxRow {
    let state = match cached.state {
        InboxState::NeedsYou | InboxState::Working => cached.state,
        InboxState::Done | InboxState::Idle => settled(cached.updated_at, mark, now_ms),
    };
    let run_started_at = matches!(state, InboxState::NeedsYou | InboxState::Working)
        .then_some(cached.run_started_at)
        .flatten();
    InboxRow {
        machine_id: cached.machine_id.clone(),
        machine_name: cached.machine_name.clone(),
        session: cached.session.clone(),
        title: cached.title.clone(),
        cwd: cached.cwd.clone(),
        state,
        updated_at: cached.updated_at,
        run_started_at,
        ask: cached.ask.clone(),
        command: cached.command.clone(),
        pending: None,
        cached: true,
    }
}

/// A session a view is open on is read from its live state, which knows every pending
/// interaction; any other from its row, whose status says whether a blocking one waits.
pub(super) fn is_settled(row: &SessionSummary, live: Option<&LiveInfo>) -> bool {
    let needs_you = live.map_or(row.status == SessionStatus::WaitingForUser, |live| {
        live.needs_you
    });
    let working = live.map_or(row.status == SessionStatus::Running, |live| live.working);
    !needs_you && !working
}

fn state_of(row: &SessionSummary, live: Option<&LiveInfo>, mark: Mark, now_ms: i64) -> InboxState {
    let needs_you = live.map_or(row.status == SessionStatus::WaitingForUser, |live| {
        live.needs_you
    });
    let working = live.map_or(row.status == SessionStatus::Running, |live| live.working);
    if needs_you {
        InboxState::NeedsYou
    } else if working {
        InboxState::Working
    } else {
        settled(row.updated_at, mark, now_ms)
    }
}

/// The wall clock in milliseconds, which `DONE_WINDOW_MS` is measured on.
pub(crate) fn wall_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// When the next row that is `Done` for being recent settles as `Idle`; nothing else in the rows
/// changes with time alone.
pub(crate) fn next_settle_ms(rows: &[InboxRow], now_ms: i64) -> Option<i64> {
    rows.iter()
        .filter(|row| matches!(row.state, InboxState::Done))
        .map(|row| row.updated_at.saturating_add(DONE_WINDOW_MS + 1))
        .filter(|at| *at > now_ms)
        .min()
}

/// Done when the person marked the session unread, or something happened within `DONE_WINDOW_MS`
/// since their marker or with no marker.
fn settled(updated_at: i64, mark: Mark, now_ms: i64) -> InboxState {
    let recent = now_ms.saturating_sub(updated_at) <= DONE_WINDOW_MS;
    let done = match mark {
        Mark::Unread => true,
        Mark::SeenAt(seen_at) => recent && updated_at > seen_at,
        Mark::Unseen => recent,
    };
    if done {
        InboxState::Done
    } else {
        InboxState::Idle
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_older_than_the_done_window_settle_as_idle() {
        let now = 1_800_000_000_000;
        let within = now - DONE_WINDOW_MS;
        let older = within - 1;
        assert_eq!(settled(within, Mark::Unseen, now), InboxState::Done);
        assert_eq!(settled(older, Mark::Unseen, now), InboxState::Idle);
        assert_eq!(
            settled(older, Mark::SeenAt(older - 10), now),
            InboxState::Idle
        );
        assert_eq!(settled(within, Mark::SeenAt(within), now), InboxState::Idle);
    }

    #[test]
    fn the_next_settle_is_when_the_oldest_recent_done_row_leaves_the_window() {
        let now = 1_800_000_000_000;
        let row = |state, updated_at| InboxRow {
            machine_id: "m".to_owned(),
            machine_name: "Mac".to_owned(),
            session: broski_contract::SessionRef {
                backend: "pi".to_owned(),
                session_id: format!("{updated_at}"),
            },
            title: None,
            cwd: None,
            state,
            updated_at,
            run_started_at: None,
            ask: None,
            command: None,
            pending: None,
            cached: false,
        };
        let rows = [
            row(InboxState::Done, now - 1_000),
            row(InboxState::Done, now - 5_000),
            row(InboxState::Done, now - 5 * DONE_WINDOW_MS),
            row(InboxState::Working, now - DONE_WINDOW_MS),
            row(InboxState::Idle, now - 10_000),
        ];
        let at = next_settle_ms(&rows, now).expect("a done row settles");
        assert_eq!(at, now - 5_000 + DONE_WINDOW_MS + 1);
        assert_eq!(
            settled(now - 5_000, Mark::Unseen, at),
            InboxState::Idle,
            "idle at that moment"
        );
        assert_eq!(settled(now - 5_000, Mark::Unseen, at - 1), InboxState::Done);
        assert_eq!(
            next_settle_ms(&rows[2..], now),
            None,
            "an old row marked unread never settles"
        );
    }

    #[test]
    fn a_session_marked_unread_is_done_however_old() {
        let now = 1_800_000_000_000;
        let five_days_ago = now - 5 * DONE_WINDOW_MS;
        assert_eq!(settled(five_days_ago, Mark::Unread, now), InboxState::Done);
        assert_eq!(settled(now, Mark::Unread, now), InboxState::Done);
    }
}
