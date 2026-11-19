//! One inbox row from what a machine knows of a session, or from the cache the app restored.

use broski_contract::{SessionStatus, SessionSummary};

use super::cache::CachedRow;
use super::{InboxRow, InboxState};
use crate::machine::InboxSource;
use crate::view::stream::LiveInfo;

/// Sessions older than this settle as `Idle` even with no marker, so old history never piles up
/// in `Done`.
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
    seen: Option<i64>,
    now_ms: i64,
) -> InboxRow {
    let InboxSource { row, live } = source;
    let state = state_of(&row, live.as_ref(), seen, now_ms);
    let active = matches!(state, InboxState::NeedsYou | InboxState::Working);
    let (ask, command, pending, live_started_at) = match live {
        Some(live) => (live.ask, live.command, live.pending, live.run_started_at),
        None => (None, None, None, None),
    };
    let run_started_at = active
        .then(|| live_started_at.or(row.run_started_at))
        .flatten();
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
        pending,
        cached: false,
    }
}

/// A row as last known. Needs you and working stay as they were (nothing newer is known); done
/// and idle follow what the person has seen since.
pub(super) fn cached_row(cached: &CachedRow, seen: Option<i64>, now_ms: i64) -> InboxRow {
    let state = match cached.state {
        InboxState::NeedsYou | InboxState::Working => cached.state,
        InboxState::Done | InboxState::Idle => settled(cached.updated_at, seen, now_ms),
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

fn state_of(
    row: &SessionSummary,
    live: Option<&LiveInfo>,
    seen: Option<i64>,
    now_ms: i64,
) -> InboxState {
    let needs_you = live.map_or(row.status == SessionStatus::WaitingForUser, |live| {
        live.needs_you
    });
    let working = live.map_or(row.status == SessionStatus::Running, |live| live.working);
    if needs_you {
        InboxState::NeedsYou
    } else if working {
        InboxState::Working
    } else {
        settled(row.updated_at, seen, now_ms)
    }
}

/// Done when something happened within `DONE_WINDOW_MS` since the person's marker, or there is no
/// marker.
fn settled(updated_at: i64, seen: Option<i64>, now_ms: i64) -> InboxState {
    let recent = now_ms.saturating_sub(updated_at) <= DONE_WINDOW_MS;
    if recent && seen.is_none_or(|seen_at| updated_at > seen_at) {
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
        assert_eq!(settled(within, None, now), InboxState::Done);
        assert_eq!(settled(older, None, now), InboxState::Idle);
        assert_eq!(settled(older, Some(older - 10), now), InboxState::Idle);
        assert_eq!(settled(within, Some(within), now), InboxState::Idle);
    }
}
