//! The inbox's lists on one machine: each backend's newest sessions, paged as the person scrolls down and
//! kept up to `INBOX_CAPACITY`; while the inbox searches, each backend's sessions that match; and the
//! sessions pinned here, read with `session.get` when no list holds them.

use std::sync::Arc;

use broski_contract::{
    BackendId, ClientMessage, RejectionCode, ServerMessage, SessionGetRequest, SessionGetResult,
    SessionQuery, SessionRef, SessionSummary, MAX_CATALOG_ITEMS, MAX_PAGE_LIMIT,
};
use broski_link_session::LinkState;
use tokio::task::JoinHandle;

use super::lists::{ListSpec, Lists};
use super::state::{Catalog, InboxSearch};
use crate::machine::state::State;
use crate::machine::Shared;

/// Rows each inbox list keeps; past them the oldest go and the list stops paging. A search reaches older ones.
pub(crate) const INBOX_CAPACITY: usize = MAX_CATALOG_ITEMS;

fn spec(backend: &str, search: Option<String>) -> ListSpec {
    ListSpec {
        backend: backend.to_owned(),
        query: SessionQuery {
            cwd: None,
            parent: None,
            search,
        },
        limit: MAX_PAGE_LIMIT as i64,
        capacity: INBOX_CAPACITY,
        keeps_older: true,
    }
}

fn listed_in(lists: &Lists, ids: impl Iterator<Item = u64>, session: &SessionRef) -> bool {
    ids.filter_map(|id| lists.get(id))
        .any(|list| list.rows().iter().any(|row| &row.session == session))
}

impl Catalog {
    /// The lists a backend gets that it has not yet: its inbox list, and its search list while the inbox
    /// searches.
    pub(crate) fn feed_lists_for(&mut self, backend: &str) -> Vec<u64> {
        let mut created = Vec::new();
        if !self.inbox.iter().any(|(known, _)| known == backend) {
            let list = self.lists.create_with(spec(backend, None));
            self.inbox.push((backend.to_owned(), list));
            created.push(list);
        }
        if let Some(search) = self.search.as_mut() {
            if !search.lists.iter().any(|(known, _)| known == backend) {
                let list = self
                    .lists
                    .create_with(spec(backend, Some(search.query.clone())));
                search.lists.push((backend.to_owned(), list));
                created.push(list);
            }
        }
        created
    }

    /// Every list the inbox reads rows from.
    pub(crate) fn feed_lists(&self) -> Vec<u64> {
        let searched = self.search.iter().flat_map(|search| search.lists.iter());
        self.inbox
            .iter()
            .chain(searched)
            .map(|(_, id)| *id)
            .collect()
    }

    /// The lists the inbox pages as the person scrolls: the search's while it searches.
    pub(crate) fn paged_lists(&self) -> &[(BackendId, u64)] {
        self.search
            .as_ref()
            .map_or(self.inbox.as_slice(), |search| search.lists.as_slice())
    }
}

impl Shared {
    /// The inbox's lists from their first page again, each fetched on the link runtime; the handles
    /// finish once the pages are answered. A link that is down, or a bridge that has not agreed on
    /// the protocol, would only hold the requests, so then a link waiting to dial dials now instead.
    pub(crate) fn reload_inbox(self: &Arc<Self>) -> Vec<JoinHandle<()>> {
        let (ready, waiting, lists) = {
            let state = self.lock();
            let lists = state.catalog.feed_lists();
            let connected = matches!(state.link.state, LinkState::Connected { .. });
            let waiting = matches!(state.link.state, LinkState::Waiting(_));
            (connected && state.contract.ready(), waiting, lists)
        };
        if !ready {
            if waiting {
                self.session().network_changed();
            }
            return Vec::new();
        }
        lists
            .into_iter()
            .map(|list| {
                let shared = Arc::clone(self);
                self.runtime().handle().spawn(async move {
                    if let Err(error) = shared.fetch_page(list, true).await {
                        tracing::debug!(%error, "reloading an inbox list failed");
                    }
                })
            })
            .collect()
    }

    /// The paged list to read on, with its oldest row's time: of those with more to load, no page on
    /// its way and no failed page waiting for a reload, the one whose loaded rows end newest. None on
    /// a machine that cannot answer a page now, which would only hold the request.
    pub(crate) fn next_feed_page(&self) -> Option<(i64, u64)> {
        let state = self.lock();
        if !state.serving() {
            return None;
        }
        let lists = &state.catalog.lists;
        (state.catalog.paged_lists().iter())
            .filter_map(|(_, id)| Some((*id, lists.get(*id)?)))
            .filter(|(_, list)| {
                list.loaded() && list.has_more() && !list.loading() && !list.failed()
            })
            .map(|(id, list)| {
                (
                    list.rows().last().map_or(i64::MAX, |row| row.updated_at),
                    id,
                )
            })
            .max_by_key(|(edge, _)| *edge)
    }

    /// What the inbox searches for, `None` once it no longer does: the last search's lists go, and each
    /// backend gets a list of its sessions that match.
    pub(crate) fn set_search(self: &Arc<Self>, query: Option<String>) {
        let created = {
            let mut state = self.lock();
            let catalog = &mut state.catalog;
            if catalog.search.as_ref().map(|search| &search.query) == query.as_ref() {
                return;
            }
            for (_, list) in catalog
                .search
                .take()
                .into_iter()
                .flat_map(|search| search.lists)
            {
                catalog.lists.remove(list);
            }
            match query {
                Some(query) => {
                    catalog.search = Some(InboxSearch {
                        query,
                        lists: Vec::new(),
                    });
                    let backends = catalog.backends().unwrap_or_default();
                    backends
                        .iter()
                        .flat_map(|backend| catalog.feed_lists_for(&backend.id))
                        .collect()
                }
                None => Vec::new(),
            }
        };
        for list in created {
            self.spawn_page(list, false);
        }
        self.poke_inbox();
    }

    /// The sessions pinned on this machine.
    pub(crate) fn set_kept(self: &Arc<Self>, sessions: Vec<SessionRef>) {
        let mut state = self.lock();
        state.catalog.kept.set(sessions);
        self.read_kept(&mut state);
        drop(state);
        self.poke_inbox();
    }

    /// Reads each pinned session no inbox list holds, on a bridge that is ready; one that fails is read
    /// again with the next page any inbox list loads.
    pub(crate) fn read_kept(self: &Arc<Self>, state: &mut State) {
        if !state.contract.ready() || state.ended.is_some() {
            return;
        }
        let catalog = &mut state.catalog;
        let feed = catalog.feed_lists();
        let wanted = catalog
            .kept
            .start_reads(|session| listed_in(&catalog.lists, feed.iter().copied(), session));
        for session in wanted {
            let shared = Arc::clone(self);
            self.runtime().handle().spawn(async move {
                let outcome = shared.read_session(&session).await;
                shared.lock().catalog.kept.read(&session, outcome);
                shared.poke_inbox();
            });
        }
    }

    /// The session's row; `None` for a session the machine does not have.
    async fn read_session(&self, session: &SessionRef) -> Result<Option<SessionSummary>, ()> {
        let request = ClientMessage::SessionGet(SessionGetRequest {
            request_id: String::new(),
            session: session.clone(),
        });
        match self.request(request).await {
            Ok(ServerMessage::SessionGetResult(answer)) => match answer.result {
                SessionGetResult::Accepted(found) => Ok(Some(found.summary)),
                SessionGetResult::Rejected(rejected)
                    if rejected.rejection.code == RejectionCode::NotFound =>
                {
                    Ok(None)
                }
                SessionGetResult::Rejected(_) => Err(()),
            },
            Ok(_) | Err(_) => Err(()),
        }
    }
}
