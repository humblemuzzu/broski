//! The inbox past its first page, on a real machine: older sessions load as the person scrolls and a
//! refresh keeps them, a search reaches sessions not loaded, and a pinned session shows however old.

mod common;

use std::time::Duration;

use broski_client::{InboxUpdate, KeptSession, LinkState, MachineStatus, Phone};
use broski_contract::SessionRef;
use broski_link_testkit::WAIT;
use common::{paired, phone, status_until, Mac};
use tokio::time::{timeout_at, Instant};

/// Pulls the inbox's changes until an update satisfies `done`.
async fn update_until(
    phone: &Phone,
    what: &str,
    done: impl Fn(&InboxUpdate) -> bool,
) -> InboxUpdate {
    let inbox = phone.inbox();
    let deadline = Instant::now() + WAIT;
    loop {
        let update = timeout_at(deadline, inbox.next_change())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
        if done(&update) {
            return update;
        }
    }
}

fn holds(update: &InboxUpdate, session: &SessionRef) -> bool {
    update.rows.iter().any(|row| &row.session == session)
}

/// A machine with `count` sessions seeded after `first`, oldest first.
/// A machine whose sessions are all newer than those of the machine seeded just before it. The fake
/// bridge stamps each seed a millisecond or more after the last, running ahead of the wall clock while
/// it seeds (up to a second for 450), so this one waits that lead out.
async fn crowded_later(first: &str, count: usize) -> (Mac, SessionRef) {
    tokio::time::sleep(Duration::from_secs(2)).await;
    crowded(first, count).await
}

async fn crowded(first: &str, count: usize) -> (Mac, SessionRef) {
    let mut mac = Mac::on_lan().await;
    let root = mac.root();
    let oldest = mac.bridge.seed(&root, first).await;
    for index in 0..count {
        mac.bridge
            .seed(&root, &format!("Session number {index}"))
            .await;
    }
    (mac, oldest)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn older_sessions_load_page_by_page_and_a_refresh_keeps_what_was_loaded() {
    let (mac, oldest) = crowded("The very first one", 449).await;
    let phone = phone();
    let _machine = paired(&phone, &mac).await;
    let first = update_until(&phone, "the first page", |update| update.rows.len() == 200).await;
    assert!(first.has_more, "450 sessions do not fit one page");
    assert!(!holds(&first, &oldest));

    phone.inbox().load_more().await;
    update_until(&phone, "the second page", |update| update.rows.len() == 400).await;
    phone.inbox().load_more().await;
    let all = update_until(&phone, "every session", |update| update.rows.len() == 450).await;
    assert!(!all.has_more, "nothing left to load");
    assert!(holds(&all, &oldest));

    phone.inbox().refresh().await;
    assert_eq!(
        phone.inbox().rows().len(),
        450,
        "a refresh reads the newest again and keeps the older rows"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn older_rows_wait_for_a_machine_with_more_to_load_but_not_once_it_is_away() {
    let (older, _) = crowded("Older machine", 4).await;
    let (mut busy, _) = crowded_later("Busy machine", 249).await;
    let phone = phone();
    let _older = paired(&phone, &older).await;
    let busy_machine = paired(&phone, &busy).await;
    let first = update_until(&phone, "the busy machine's first page", |update| {
        update.rows.len() == 200
            && update
                .rows
                .iter()
                .all(|row| row.machine_id == busy_machine.id())
    })
    .await;
    assert!(first.has_more);

    busy.stop_daemon().await;
    let away = update_until(&phone, "the older machine's rows", |update| {
        update.rows.len() == 205
    })
    .await;
    assert!(
        !away.has_more,
        "a machine that is away has nothing to load now"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn load_more_pages_a_machine_that_is_here_and_never_one_that_is_away() {
    let (older, _) = crowded("Older machine", 449).await;
    let (mut busy, _) = crowded_later("Busy machine", 449).await;
    let phone = phone();
    let older_machine = paired(&phone, &older).await;
    let busy_machine = paired(&phone, &busy).await;
    let of = |update: &InboxUpdate, machine: &str| {
        (update.rows.iter())
            .filter(|row| row.machine_id == machine)
            .count()
    };
    update_until(&phone, "the busy machine's first page", |update| {
        of(update, &busy_machine.id()) == 200
    })
    .await;

    busy.stop_daemon().await;
    let away = |status: &MachineStatus| !matches!(status.link.state, LinkState::Connected { .. });
    status_until(&busy_machine, "the busy machine to be away", away).await;
    let older_id = older_machine.id();
    let first = update_until(&phone, "the older machine's first page", |update| {
        of(update, &older_id) == 200
    })
    .await;
    assert!(first.has_more, "the older machine has more");
    let paged = tokio::time::timeout(Duration::from_secs(10), phone.inbox().load_more()).await;
    assert!(
        paged.is_ok(),
        "a page from the machine that is here, not a request held for one that is away"
    );
    update_until(&phone, "the older machine's second page", |update| {
        of(update, &older_id) == 400
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_search_reaches_a_session_no_page_loaded_and_ends_with_an_empty_query() {
    let (mac, needle) = crowded("A needle in the haystack", 300).await;
    let phone = phone();
    let _machine = paired(&phone, &mac).await;
    let first = update_until(&phone, "the first page", |update| update.rows.len() == 200).await;
    assert!(!holds(&first, &needle));

    phone.inbox().search("  HAYSTACK needle ".to_owned());
    let found = update_until(&phone, "the search's match", |update| {
        holds(update, &needle)
    })
    .await;
    assert!(!found.has_more, "the search read every session");

    phone.inbox().search("   ".to_owned());
    update_until(&phone, "the search to end", |update| {
        !holds(update, &needle)
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_pinned_session_shows_however_far_down_it_lies_until_it_is_unpinned() {
    let (mac, pinned) = crowded("Pinned long ago", 250).await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let first = update_until(&phone, "the first page", |update| update.rows.len() == 200).await;
    assert!(!holds(&first, &pinned));

    let kept = KeptSession {
        machine_id: machine.id(),
        session: pinned.clone(),
    };
    phone.inbox().keep(vec![kept]);
    let shown = update_until(&phone, "the pinned session", |update| {
        holds(update, &pinned)
    })
    .await;
    assert_eq!(
        shown.rows.len(),
        201,
        "the first page and the pinned session"
    );

    phone.inbox().keep(Vec::new());
    update_until(&phone, "the pin to go", |update| !holds(update, &pinned)).await;
}
