//! The last known inbox across a phone restart: the cache a phone hands out shows its rows at the
//! next start while the machine is offline, never with an ask to answer; the machine's own rows
//! replace them once it is back, and forgetting the machine drops them.

mod common;

use broski_client::{new_identity_secret, InboxRow, InboxState, LinkState, MachineStatus, Phone};
use broski_contract::SessionRef;
use broski_link_testkit::relay::TestRelay;
use broski_link_testkit::WAIT;
use common::{inbox_until, paired, phone_with, status_until, Mac};
use tokio::time::{timeout_at, Instant};

fn row<'a>(rows: &'a [InboxRow], session: &SessionRef) -> Option<&'a InboxRow> {
    rows.iter().find(|row| &row.session == session)
}

/// Pulls updates until one carries a cache in which `done` holds of the rows; returns the bytes
/// and the seen state handed out on the way.
async fn persisted(
    phone: &Phone,
    done: impl Fn(&[InboxRow]) -> bool,
) -> (Vec<u8>, Option<broski_client::SeenState>) {
    let deadline = Instant::now() + WAIT;
    let mut seen = None;
    loop {
        let update = timeout_at(deadline, phone.inbox().next_change())
            .await
            .expect("a cache to persist");
        seen = update.seen.or(seen);
        if let Some(cache) = update.cache {
            if done(&update.rows) {
                return (cache, seen);
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_restarted_phone_shows_the_last_inbox_until_the_machine_is_back() {
    // Over the relay: the daemon comes back on another LAN port.
    let relay = TestRelay::start().await;
    let mut mac = Mac::on_relay(&relay).await;
    let idle = mac.bridge.seed(&mac.root(), "Yesterday").await;
    let asking = mac.bridge.seed(&mac.root(), "Needs a yes").await;
    let secret = new_identity_secret().expect("a secret");
    let first = phone_with(secret.clone());
    let machine = paired(&first, &mac).await;
    let record = machine.record();
    mac.bridge.run(&asking, "permission").await;
    let (cache, seen) = persisted(&first, |rows| {
        row(rows, &asking).is_some_and(|row| row.pending.is_some()) && row(rows, &idle).is_some()
    })
    .await;
    drop((machine, first));

    mac.stop_daemon().await;
    let second = phone_with(secret);
    if let Some(seen) = seen {
        second.inbox().restore_seen(seen);
    }
    second
        .inbox()
        .restore_cache(cache)
        .expect("the cache restores");
    let machine = second.start(record).expect("started");
    let offline = |status: &MachineStatus| matches!(status.link.state, LinkState::Waiting(_));
    status_until(&machine, "the machine to be unreachable", offline).await;
    let rows = second.inbox().rows();
    let waiting = row(&rows, &asking).expect("the waiting row, cached");
    assert!(waiting.cached);
    assert_eq!(waiting.state, InboxState::NeedsYou, "as last known");
    assert_eq!(waiting.ask.as_deref(), Some("Run bash?"));
    assert_eq!(waiting.command.as_deref(), Some("bash"));
    assert!(waiting.pending.is_none(), "no answer from a cache");
    let quiet = row(&rows, &idle).expect("the idle row, cached");
    assert_eq!((quiet.cached, quiet.state), (true, InboxState::Idle));
    assert_eq!(quiet.title.as_deref(), Some("Yesterday"));

    mac.start_daemon().await;
    status_until(&machine, "the machine back", common::ready).await;
    let rows = inbox_until(&second, "the machine's own rows", |rows| {
        row(rows, &asking).is_some_and(|row| !row.cached && row.pending.is_some())
    })
    .await;
    assert!(
        rows.iter().all(|row| !row.cached),
        "every cached row is replaced"
    );

    second.forget(machine.id());
    inbox_until(&second, "a forgotten machine's rows gone", |rows| {
        rows.is_empty()
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_forgotten_machine_takes_its_cached_rows_and_bad_bytes_change_nothing() {
    let mut mac = Mac::on_lan().await;
    let session = mac.bridge.seed(&mac.root(), "Kept").await;
    let secret = new_identity_secret().expect("a secret");
    let first = phone_with(secret.clone());
    let machine = paired(&first, &mac).await;
    let record = machine.record();
    let (cache, _) = persisted(&first, |rows| row(rows, &session).is_some()).await;
    drop((machine, first));
    mac.stop_daemon().await;

    let second = phone_with(secret);
    second.inbox().restore_cache(cache).expect("restored");
    let newer = b"{\"version\":9,\"rows\":[]}".to_vec();
    assert!(second.inbox().restore_cache(newer).is_err());
    assert!(
        second.inbox().rows().is_empty(),
        "no row before its machine starts"
    );
    let machine = second.start(record).expect("started");
    let rows = second.inbox().rows();
    assert!(
        row(&rows, &session).is_some_and(|row| row.cached),
        "the cached row shows as its machine starts: {rows:?}"
    );
    second.forget(machine.id());
    assert!(second.inbox().rows().is_empty());
}
