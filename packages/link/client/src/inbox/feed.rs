//! What the app asks of the inbox's lists: older sessions as the person scrolls down, a search of every
//! machine's sessions, and the sessions they pinned.

use std::sync::Arc;

use broski_contract::{SessionRef, MAX_SEARCH_QUERY_CHARS};

use super::{locked, Inbox};

/// A session pinned on one machine: the inbox shows it however far down its lists it lies.
#[derive(Debug, Clone, PartialEq)]
pub struct KeptSession {
    pub machine_id: String,
    pub session: SessionRef,
}

/// The query trimmed and cut to the contract's bound, counted in UTF-16 units as the bridge counts it.
fn bounded(query: &str) -> String {
    let mut units = 0;
    let cut: String = query
        .trim()
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= MAX_SEARCH_QUERY_CHARS
        })
        .collect();
    cut.trim_end().to_owned()
}

/// The sessions of `kept` pinned on `machine_id`.
pub(super) fn kept_on(kept: &[KeptSession], machine_id: &str) -> Vec<SessionRef> {
    kept.iter()
        .filter(|kept| kept.machine_id == machine_id)
        .map(|kept| kept.session.clone())
        .collect()
}

impl Inbox {
    /// The next page of the list the inbox has loaded least far down, on whichever machine holds it;
    /// returns once it is in. Nothing when every list is loaded or has a page on its way: the next
    /// `InboxUpdate` says whether more remain.
    pub async fn load_more(&self) {
        let machines = locked(&self.machines).clone();
        let next = machines
            .iter()
            .filter_map(|machine| {
                let (edge, list) = machine.shared().next_feed_page()?;
                Some((edge, Arc::clone(machine), list))
            })
            .max_by_key(|(edge, _, _)| *edge);
        if let Some((_, machine, list)) = next {
            if let Err(error) = machine.shared().load(list, false).await {
                tracing::debug!(%error, "an older page of the inbox failed");
            }
        }
    }

    /// Searches every machine's sessions for `query`, every word of it in a session's title or folder;
    /// the matches join the rows as each machine answers, paged by `load_more`. Spaces alone end the search;
    /// past `MAX_SEARCH_QUERY_CHARS` the query is cut, as the bridge would refuse it.
    pub fn search(&self, query: String) {
        let query = Some(bounded(&query)).filter(|query| !query.is_empty());
        let mut tracker = locked(&self.tracker);
        if tracker.search == query {
            return;
        }
        tracker.search = query.clone();
        drop(tracker);
        for machine in locked(&self.machines).clone() {
            machine.shared().set_search(query.clone());
        }
        self.wake.notify_one();
    }

    /// The sessions the person pinned, on every machine: each shows whether or not a list holds it,
    /// read from its machine when none does.
    pub fn keep(&self, sessions: Vec<KeptSession>) {
        let mut tracker = locked(&self.tracker);
        if tracker.kept == sessions {
            return;
        }
        tracker.kept = sessions.clone();
        drop(tracker);
        for machine in locked(&self.machines).clone() {
            machine.shared().set_kept(kept_on(&sessions, &machine.id()));
        }
        self.wake.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_query_is_trimmed_and_cut_to_the_bound_without_splitting_a_character() {
        assert_eq!(bounded("  inbox  paging "), "inbox  paging");
        assert_eq!(bounded(&"a".repeat(300)).len(), MAX_SEARCH_QUERY_CHARS);
        let emoji = format!("{}{}", "a".repeat(MAX_SEARCH_QUERY_CHARS - 1), "\u{1F600}");
        assert_eq!(bounded(&emoji), "a".repeat(MAX_SEARCH_QUERY_CHARS - 1));
        let spaced = format!("{} tail", "a".repeat(MAX_SEARCH_QUERY_CHARS - 1));
        assert_eq!(bounded(&spaced), "a".repeat(MAX_SEARCH_QUERY_CHARS - 1));
    }
}
