//! What the inbox reads of one machine: the rows of its lists and its pinned sessions with what a view of
//! each knows live, how far the lists it pages have loaded, and whether any of that changed.

use std::collections::HashSet;

use broski_contract::SessionRef;
use broski_link_session::LinkState;

use super::state::State;
use super::InboxSource;
use crate::catalog::lists::key;
use crate::view::stream::LiveInfo;

/// One machine's part of the inbox.
pub(crate) struct Feed {
    /// Every inbox list's first page is in.
    pub(crate) loaded: bool,
    pub(crate) sources: Vec<InboxSource>,
    /// How far down the lists the inbox pages have loaded: the newest of their oldest rows, among those
    /// with more to load. Settled rows older than it wait until those lists reach them, so rows never
    /// appear above where a person reads. None while the machine cannot answer a page, so a machine
    /// that is away holds back no other machine's rows.
    pub(crate) frontier: Option<i64>,
    /// A list the inbox pages has more to load, and the machine can answer for it.
    pub(crate) has_more: bool,
}

/// What the inbox shows of a machine changes only with this: rebuilding it on every event of a chat
/// that streams costs the phone a share of a core per thousand rows.
#[derive(PartialEq)]
pub(crate) struct FeedStamp {
    lists: Vec<(u64, u64)>,
    kept: u64,
    loaded: bool,
    name: String,
    ended: bool,
    serving: bool,
    live: Vec<(SessionRef, Option<LiveInfo>)>,
}

impl State {
    pub(crate) fn inbox_feed(&self) -> Feed {
        let lists = &self.catalog.lists;
        let kept = &self.catalog.kept;
        let mut seen: HashSet<(&str, &str)> = HashSet::new();
        let mut sources = Vec::new();
        let rows = (self.catalog.feed_lists().into_iter())
            .filter_map(|id| lists.get(id))
            .flat_map(|list| list.rows())
            .chain(kept.rows());
        for row in rows {
            if seen.insert(key(&row.session)) {
                sources.push(InboxSource {
                    live: self.streams.live_info(&row.session),
                    pinned: kept.contains(&row.session),
                    row: row.clone(),
                });
            }
        }
        let serving = self.serving();
        let paged = (self.catalog.paged_lists().iter())
            .filter_map(|(_, id)| lists.get(*id))
            .filter(|list| serving && list.has_more() && !list.failed());
        let mut frontier = None;
        let mut has_more = false;
        for list in paged {
            has_more = true;
            if list.loaded() {
                let oldest = list.rows().last().map_or(i64::MAX, |row| row.updated_at);
                frontier = Some(frontier.map_or(oldest, |known: i64| known.max(oldest)));
            }
        }
        Feed {
            loaded: self.inbox_loaded(),
            sources,
            frontier,
            has_more,
        }
    }

    fn feed_stamp(&self) -> FeedStamp {
        let lists = &self.catalog.lists;
        FeedStamp {
            lists: (self.catalog.feed_lists().into_iter())
                .map(|id| (id, lists.get(id).map_or(u64::MAX, |list| list.version())))
                .collect(),
            kept: self.catalog.kept.version(),
            loaded: self.inbox_loaded(),
            name: self.record.name.clone(),
            ended: self.ended.is_some(),
            serving: self.serving(),
            live: self.streams.live_fingerprint(),
        }
    }

    /// The machine answers pages now: its link is up and its bridge agreed on the protocol.
    pub(crate) fn serving(&self) -> bool {
        matches!(self.link.state, LinkState::Connected { .. })
            && self.contract.ready()
            && self.ended.is_none()
    }

    /// Whether anything the inbox reads of this machine changed since the last call.
    pub(crate) fn feed_changed(&mut self) -> bool {
        let now = self.feed_stamp();
        if self.feed_seen.as_ref() == Some(&now) {
            return false;
        }
        self.feed_seen = Some(now);
        true
    }
}
