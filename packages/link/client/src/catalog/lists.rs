//! Session lists by (backend, query), paged from the bridge and kept current by the rows its catalog
//! sends: a list is never sent whole (contract README §5, §11.1).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use broski_contract::{
    BackendId, ClientMessage, PageCursor, PageRequest, SessionPage, SessionQuery, SessionRef,
    SessionSummary, SessionsListRequest, MAX_CATALOG_ITEMS,
};
use tokio::sync::Notify;

use super::search::{search_words, session_matches};

/// One list: its rows newest first, one per session, and where its next page starts.
pub(crate) struct ListState {
    backend: BackendId,
    query: SessionQuery,
    /// `query.search` as `session_matches` reads it.
    words: Vec<String>,
    limit: i64,
    /// Rows past it go, oldest first, and the list asks for no more pages.
    capacity: usize,
    /// The first page of a reload replaces the rows it covers and keeps the older ones loaded.
    keeps_older: bool,
    rows: Vec<SessionSummary>,
    cursor: Option<PageCursor>,
    loaded: bool,
    current: bool,
    loading: bool,
    /// Its last page failed: the inbox stops paging it until a reload or a page goes through.
    failed: bool,
    /// Bumped by a reload, so a page asked for before it is not merged after it.
    generation: u64,
    changed: bool,
    /// Bumped by every change of the rows or of where the next page starts.
    version: u64,
    pub(crate) notify: Arc<Notify>,
}

/// A page to ask for, and the generation its answer must still match.
pub(crate) struct PageAsk {
    pub(crate) cursor: Option<PageCursor>,
    pub(crate) generation: u64,
}

/// What a list holds and how: its query, its page size, how many rows it keeps, and whether a reload keeps the
/// older rows it loaded.
pub(crate) struct ListSpec {
    pub(crate) backend: BackendId,
    pub(crate) query: SessionQuery,
    pub(crate) limit: i64,
    pub(crate) capacity: usize,
    pub(crate) keeps_older: bool,
}

impl ListState {
    fn new(spec: ListSpec) -> ListState {
        ListState {
            words: search_words(spec.query.search.as_deref().unwrap_or("")),
            backend: spec.backend,
            query: spec.query,
            limit: spec.limit,
            capacity: spec.capacity,
            keeps_older: spec.keeps_older,
            rows: Vec::new(),
            cursor: None,
            loaded: false,
            current: false,
            loading: false,
            failed: false,
            generation: 0,
            changed: false,
            version: 0,
            notify: Arc::new(Notify::new()),
        }
    }

    pub(crate) fn rows(&self) -> &[SessionSummary] {
        &self.rows
    }

    pub(crate) fn loaded(&self) -> bool {
        self.loaded
    }

    pub(crate) fn current(&self) -> bool {
        self.current
    }

    pub(crate) fn loading(&self) -> bool {
        self.loading
    }

    pub(crate) fn failed(&self) -> bool {
        self.failed
    }

    pub(crate) fn version(&self) -> u64 {
        self.version
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
            backend: self.backend.clone(),
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
        self.failed = false;
        PageAsk {
            cursor: None,
            generation: self.generation,
        }
    }

    pub(crate) fn page_failed(&mut self, generation: u64) {
        if generation == self.generation {
            self.loading = false;
            self.failed = true;
            self.version += 1;
        }
    }

    /// Merges a page. The first page of a reload replaces every row, or, in a list that keeps the
    /// older rows it loaded, the rows down to the page's oldest; the older rows' cursor stays theirs.
    pub(crate) fn page(&mut self, ask: &PageAsk, page: SessionPage) {
        if ask.generation != self.generation {
            return;
        }
        self.loading = false;
        self.failed = false;
        let next = page.next_cursor;
        match page.items.last() {
            Some(oldest)
                if ask.cursor.is_none() && self.keeps_older && self.loaded && next.is_some() =>
            {
                self.rows.retain(|row| newer(oldest, row));
                if self.rows.is_empty() {
                    self.cursor = next;
                }
            }
            _ if ask.cursor.is_none() => {
                self.rows.clear();
                self.cursor = next;
            }
            _ => self.cursor = next,
        }
        self.loaded = true;
        self.current = true;
        self.merge(page.items);
        self.touch();
    }

    /// The page's rows into the list, each once, in one pass over both: a reload's page lands in front of
    /// thousands of kept rows.
    fn merge(&mut self, mut items: Vec<SessionSummary>) {
        let incoming: HashSet<(&str, &str)> = items.iter().map(|row| key(&row.session)).collect();
        self.rows
            .retain(|known| !incoming.contains(&key(&known.session)));
        items.sort_by(order);
        let mut kept = std::mem::take(&mut self.rows).into_iter().peekable();
        let mut added = items.into_iter().peekable();
        let mut rows = Vec::with_capacity(kept.len() + added.len());
        loop {
            let next = match (kept.peek(), added.peek()) {
                (Some(known), Some(row)) if newer(row, known) => added.next(),
                (Some(_), _) => kept.next(),
                (None, _) => added.next(),
            };
            let Some(row) = next else { break };
            rows.push(row);
        }
        self.rows = rows;
        self.bound();
    }

    fn matches(&self, row: &SessionSummary) -> bool {
        row.session.backend == self.backend
            && self
                .query
                .cwd
                .as_ref()
                .is_none_or(|cwd| row.cwd.as_ref() == Some(cwd))
            && row.parent.as_ref().map(|parent| &parent.session) == self.query.parent.as_ref()
            && session_matches(
                &self.words,
                row.title.as_ref().map(|title| title.text.as_str()),
                row.cwd.as_deref(),
            )
    }

    fn upsert(&mut self, row: SessionSummary) {
        self.rows.retain(|known| known.session != row.session);
        let at = self.rows.partition_point(|known| newer(known, &row));
        self.rows.insert(at, row);
        self.bound();
    }

    /// Past the capacity the oldest rows go, and the list is full: a next page would land behind rows
    /// it no longer holds.
    fn bound(&mut self) {
        if self.rows.len() > self.capacity {
            self.rows.truncate(self.capacity);
            self.cursor = None;
        }
    }

    fn touch(&mut self) {
        self.version += 1;
        self.changed = true;
        self.notify.notify_one();
    }

    /// Whether the rows changed since the last call.
    pub(crate) fn take_change(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }
}

/// A session as a set holds it: its backend and id.
pub(crate) fn key(session: &SessionRef) -> (&str, &str) {
    (&session.backend, &session.session_id)
}

/// Newest first; one moment's rows by session id, so the order is total.
pub(crate) fn newer(a: &SessionSummary, b: &SessionSummary) -> bool {
    (a.updated_at, &b.session.session_id) > (b.updated_at, &a.session.session_id)
}

fn order(a: &SessionSummary, b: &SessionSummary) -> std::cmp::Ordering {
    (b.updated_at, &a.session.session_id).cmp(&(a.updated_at, &b.session.session_id))
}

#[derive(Default)]
pub(crate) struct Lists {
    next: u64,
    lists: HashMap<u64, ListState>,
}

impl Lists {
    pub(crate) fn create(&mut self, backend: BackendId, query: SessionQuery, limit: i64) -> u64 {
        self.create_with(ListSpec {
            backend,
            query,
            limit,
            capacity: MAX_CATALOG_ITEMS,
            keeps_older: false,
        })
    }

    pub(crate) fn create_with(&mut self, spec: ListSpec) -> u64 {
        self.next += 1;
        self.lists.insert(self.next, ListState::new(spec));
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

    /// A link pause, drop or new bridge socket means cached rows may lag behind the Mac until reloaded.
    pub(crate) fn mark_stale(&mut self) {
        for list in self.lists.values_mut() {
            list.current = false;
        }
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
#[path = "lists_tests.rs"]
mod tests;
