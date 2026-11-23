//! The rows as they stand: every machine's feed, its history marked seen at its first read, cached rows
//! for a machine whose lists have not loaded, and settled rows held back until the paged lists reach them.

use std::cmp::Reverse;

use super::rows::{self, cached_row, live_row, MachineName};
use super::{locked, Inbox, InboxRow, InboxState};
use crate::machine::feed::Feed;

/// The rows as they stand, and whether older ones are still to load.
#[derive(Clone, PartialEq)]
pub(super) struct Computed {
    pub(super) rows: Vec<InboxRow>,
    pub(super) has_more: bool,
}

impl Inbox {
    pub(super) fn sources(&self) -> Vec<(MachineName, Feed)> {
        locked(&self.machines)
            .iter()
            .map(|machine| {
                let state = machine.shared().lock();
                let feed = state.inbox_feed();
                let name = MachineName {
                    id: machine.id(),
                    name: state.record.name.clone(),
                    loaded: feed.loaded,
                };
                (name, feed)
            })
            .collect()
    }

    /// The sources, after the history of every machine whose rows are all in for the first time
    /// has been marked seen, and its cached rows let go.
    pub(super) fn settle(&self) -> Vec<(MachineName, Feed)> {
        let feeds = self.sources();
        let now_ms = rows::wall_ms();
        let mut tracker = locked(&self.tracker);
        for (machine, feed) in &feeds {
            if machine.loaded {
                tracker.seen.first_read(&machine.id, &feed.sources, now_ms);
                tracker.seen.resolve(&machine.id, &feed.sources);
                tracker.cache.drop_machine(&machine.id);
            }
        }
        drop(tracker);
        feeds
    }

    /// A machine whose lists have not loaded shows its cached rows, when the app restored any. A
    /// settled row older than where the paged lists have loaded to waits for them, unless it is pinned.
    pub(super) fn compute(&self) -> Computed {
        let feeds = self.settle();
        let now_ms = rows::wall_ms();
        let edge = (feeds.iter())
            .filter(|(machine, _)| machine.loaded)
            .filter_map(|(_, feed)| feed.frontier)
            .max();
        let has_more = feeds.iter().any(|(_, feed)| feed.has_more);
        let tracker = locked(&self.tracker);
        let mut rows: Vec<InboxRow> = Vec::new();
        for (machine, feed) in feeds {
            let cached = tracker.cache.rows_of(&machine.id);
            if !machine.loaded && !cached.is_empty() {
                for row in cached {
                    let mark = tracker.seen.get(&machine.id, &row.session);
                    rows.push(cached_row(row, mark, now_ms));
                }
                continue;
            }
            for source in feed.sources {
                let mark = tracker.seen.get(&machine.id, &source.row.session);
                let pinned = source.pinned;
                let row = live_row(&machine, source, mark, now_ms);
                let settled = matches!(row.state, InboxState::Done | InboxState::Idle);
                if !pinned && settled && edge.is_some_and(|edge| row.updated_at < edge) {
                    continue;
                }
                rows.push(row);
            }
        }
        rows.sort_by(|a, b| {
            (
                a.state,
                Reverse(a.updated_at),
                &a.machine_id,
                &a.session.session_id,
            )
                .cmp(&(
                    b.state,
                    Reverse(b.updated_at),
                    &b.machine_id,
                    &b.session.session_id,
                ))
        });
        Computed { rows, has_more }
    }
}
