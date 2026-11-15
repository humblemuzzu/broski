//! Session lists by (backend, query), paged from the bridge and kept current by the rows its catalog
//! sends: a list is never sent whole (contract README §5, §11.1).

use std::collections::HashMap;
use std::sync::Arc;

use broski_contract::{
    BackendId, ClientMessage, PageCursor, PageRequest, SessionPage, SessionQuery, SessionRef,
    SessionSummary, SessionsListRequest, MAX_CATALOG_ITEMS,
};
use tokio::sync::Notify;

/// One list: its rows newest first, one per session, and where its next page starts.
pub(crate) struct ListState {
    backend: BackendId,
    query: SessionQuery,
    limit: i64,
    /// Rows past it go, oldest first.
    capacity: usize,
    rows: Vec<SessionSummary>,
    cursor: Option<PageCursor>,
    loaded: bool,
    loading: bool,
    /// Bumped by a reload, so a page asked for before it is not merged after it.
    generation: u64,
    changed: bool,
    pub(crate) notify: Arc<Notify>,
}

/// A page to ask for, and the generation its answer must still match.
pub(crate) struct PageAsk {
    pub(crate) cursor: Option<PageCursor>,
    pub(crate) generation: u64,
}

impl ListState {
    fn new(backend: BackendId, query: SessionQuery, limit: i64, capacity: usize) -> ListState {
        ListState {
            backend,
            query,
            limit,
            capacity,
            rows: Vec::new(),
            cursor: None,
            loaded: false,
            loading: false,
            generation: 0,
            changed: false,
            notify: Arc::new(Notify::new()),
        }
    }

    pub(crate) fn rows(&self) -> &[SessionSummary] {
        &self.rows
    }

    pub(crate) fn loaded(&self) -> bool {
        self.loaded
    }

    /// More rows than those loaded exist.
    pub(crate) fn has_more(&self) -> bool {
        !self.loaded || self.cursor.is_some()
    }

    /// The request for the list's next page, or for its first again with `reload`; nothing when a
    /// page is on its way or the list has no more.
    pub(crate) fn ask(&mut self, reload: bool) -> Option<(PageAsk, ClientMessage)> {
        let ask = if reload {
            self.reload()
        } else {
            self.next_page()?
        };
        let request = ClientMessage::SessionsList(SessionsListRequest {
            request_id: String::new(),
            backend: self.backend,
            query: self.query.clone(),
            page: PageRequest {
                cursor: ask.cursor.clone(),
                limit: self.limit,
            },
        });
        Some((ask, request))
    }

    fn next_page(&mut self) -> Option<PageAsk> {
        if self.loading || !self.has_more() {
            return None;
        }
        self.loading = true;
        Some(PageAsk {
            cursor: self.cursor.clone(),
            generation: self.generation,
        })
    }

    /// The first page again: what the list holds may have changed in ways no row said.
    fn reload(&mut self) -> PageAsk {
        self.generation += 1;
        self.loading = true;
        PageAsk {
            cursor: None,
            generation: self.generation,
        }
    }

    pub(crate) fn page_failed(&mut self, generation: u64) {
        if generation == self.generation {
            self.loading = false;
        }
    }

    /// Merges a page; the first page of a reload replaces the rows.
    pub(crate) fn page(&mut self, ask: &PageAsk, page: SessionPage) {
        if ask.generation != self.generation {
            return;
        }
        if ask.cursor.is_none() {
            self.rows.clear();
        }
        self.loading = false;
        self.loaded = true;
        self.cursor = page.next_cursor;
        for row in page.items {
            self.upsert(row);
        }
        self.touch();
    }

    fn matches(&self, row: &SessionSummary) -> bool {
        row.session.backend == self.backend
            && self
                .query
                .cwd
                .as_ref()
                .is_none_or(|cwd| row.cwd.as_ref() == Some(cwd))
            && row.parent.as_ref().map(|parent| &parent.session) == self.query.parent.as_ref()
    }

    fn upsert(&mut self, row: SessionSummary) {
        self.rows.retain(|known| known.session != row.session);
        let at = self.rows.partition_point(|known| newer(known, &row));
        self.rows.insert(at, row);
        self.rows.truncate(self.capacity);
    }

    fn touch(&mut self) {
        self.changed = true;
        self.notify.notify_one();
    }

    /// Whether the rows changed since the last call.
    pub(crate) fn take_change(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }
}

/// Newest first; one moment's rows by session id, so the order is total.
fn newer(a: &SessionSummary, b: &SessionSummary) -> bool {
    (a.updated_at, &b.session.session_id) > (b.updated_at, &a.session.session_id)
}

#[derive(Default)]
pub(crate) struct Lists {
    next: u64,
    lists: HashMap<u64, ListState>,
}

impl Lists {
    pub(crate) fn create(&mut self, backend: BackendId, query: SessionQuery, limit: i64) -> u64 {
        self.create_bounded(backend, query, limit, MAX_CATALOG_ITEMS)
    }

    pub(crate) fn create_bounded(
        &mut self,
        backend: BackendId,
        query: SessionQuery,
        limit: i64,
        capacity: usize,
    ) -> u64 {
        self.next += 1;
        self.lists
            .insert(self.next, ListState::new(backend, query, limit, capacity));
        self.next
    }

    pub(crate) fn remove(&mut self, id: u64) {
        if let Some(list) = self.lists.remove(&id) {
            list.notify.notify_one();
        }
    }

    pub(crate) fn get_mut(&mut self, id: u64) -> Option<&mut ListState> {
        self.lists.get_mut(&id)
    }

    pub(crate) fn get(&self, id: u64) -> Option<&ListState> {
        self.lists.get(&id)
    }

    pub(crate) fn ids(&self) -> Vec<u64> {
        self.lists.keys().copied().collect()
    }

    /// Every reader of a list looks again: the machine ended.
    pub(crate) fn wake_all(&self) {
        for list in self.lists.values() {
            list.notify.notify_one();
        }
    }

    /// A row the catalog sent: into every list whose query it matches, out of every other.
    pub(crate) fn updated(&mut self, row: &SessionSummary) {
        for list in self.lists.values_mut() {
            let known = list.rows.iter().any(|known| known.session == row.session);
            if list.matches(row) {
                list.upsert(row.clone());
                list.touch();
            } else if known {
                list.rows.retain(|known| known.session != row.session);
                list.touch();
            }
        }
    }

    pub(crate) fn removed(&mut self, session: &SessionRef) {
        for list in self.lists.values_mut() {
            let before = list.rows.len();
            list.rows.retain(|known| &known.session != session);
            if list.rows.len() != before {
                list.touch();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use broski_contract::{ParentKind, SessionOrigin, SessionParent, SessionStatus};

    use super::*;

    fn row(id: &str, updated_at: i64, cwd: &str) -> SessionSummary {
        SessionSummary {
            session: SessionRef {
                backend: BackendId::Pi,
                session_id: id.to_owned(),
            },
            title: None,
            cwd: Some(cwd.to_owned()),
            created_at: None,
            updated_at,
            parent: None,
            model_id: None,
            status: SessionStatus::Idle,
            origin: SessionOrigin::Broski,
            source: None,
        }
    }

    fn ids(list: &ListState) -> Vec<&str> {
        list.rows()
            .iter()
            .map(|row| row.session.session_id.as_str())
            .collect()
    }

    fn list_in(lists: &mut Lists, cwd: Option<&str>) -> u64 {
        let query = SessionQuery {
            cwd: cwd.map(str::to_owned),
            parent: None,
        };
        lists.create(BackendId::Pi, query, 50)
    }

    #[test]
    fn pages_merge_newest_first_with_one_row_per_session_and_a_reload_replaces_them() {
        let mut lists = Lists::default();
        let id = list_in(&mut lists, None);
        let list = lists.get_mut(id).expect("list");
        let first = list.next_page().expect("a first page");
        assert!(list.next_page().is_none(), "one page at a time");
        list.page(
            &first,
            SessionPage {
                items: vec![row("c", 30, "/w"), row("b", 20, "/w")],
                next_cursor: Some("p2".to_owned()),
            },
        );
        let second = list.next_page().expect("a second page");
        assert_eq!(second.cursor.as_deref(), Some("p2"));
        list.page(
            &second,
            SessionPage {
                items: vec![row("b", 20, "/w"), row("a", 10, "/w")],
                next_cursor: None,
            },
        );
        assert_eq!(ids(list), ["c", "b", "a"]);
        assert!(!list.has_more());
        assert!(list.next_page().is_none());

        let reload = list.reload();
        let stale = PageAsk {
            cursor: None,
            generation: reload.generation - 1,
        };
        list.page(
            &stale,
            SessionPage {
                items: vec![row("x", 99, "/w")],
                next_cursor: None,
            },
        );
        assert_eq!(
            ids(list),
            ["c", "b", "a"],
            "a page from before the reload is dropped"
        );
        list.page(
            &reload,
            SessionPage {
                items: vec![row("d", 40, "/w")],
                next_cursor: None,
            },
        );
        assert_eq!(ids(list), ["d"]);
    }

    #[test]
    fn catalog_rows_go_into_the_lists_they_match_and_out_of_the_others() {
        let mut lists = Lists::default();
        let all = list_in(&mut lists, None);
        let here = list_in(&mut lists, Some("/here"));
        lists.updated(&row("s", 10, "/here"));
        lists.updated(&row("t", 20, "/there"));
        assert_eq!(ids(lists.get(all).expect("all")), ["t", "s"]);
        assert_eq!(ids(lists.get(here).expect("here")), ["s"]);

        lists.updated(&row("s", 30, "/there"));
        assert_eq!(
            ids(lists.get(all).expect("all")),
            ["s", "t"],
            "moved to the top"
        );
        assert!(
            ids(lists.get(here).expect("here")).is_empty(),
            "moved out of /here"
        );

        let mut child = row("child", 40, "/there");
        child.parent = Some(SessionParent {
            kind: ParentKind::Subagent,
            session: row("s", 0, "").session,
        });
        lists.updated(&child);
        assert_eq!(
            ids(lists.get(all).expect("all")),
            ["s", "t"],
            "a child is not a top-level row"
        );

        lists.removed(&row("t", 0, "").session);
        assert_eq!(ids(lists.get(all).expect("all")), ["s"]);
        assert!(lists.get_mut(all).expect("all").take_change());
    }

    #[test]
    fn a_bounded_list_keeps_its_newest_rows() {
        let mut lists = Lists::default();
        let id = lists.create_bounded(
            BackendId::Pi,
            SessionQuery {
                cwd: None,
                parent: None,
            },
            2,
            2,
        );
        for (index, updated_at) in [10, 30, 20].into_iter().enumerate() {
            lists.updated(&row(&index.to_string(), updated_at, "/w"));
        }
        assert_eq!(ids(lists.get(id).expect("list")), ["1", "2"]);
    }
}
