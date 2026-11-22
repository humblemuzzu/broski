//! The inbox over two real machines: a session waiting on the person comes first, then one that
//! works, then one that finished unseen, then the rest; seeing a session makes it idle.

mod common;

use std::sync::Arc;
use std::time::Duration;

use broski_client::{
    new_identity_secret, InboxRow, InboxState, LinkState, Machine, MachineStatus, Phone, SeenState,
    UnreadSession,
};
use broski_contract::{PromptMode, SessionQuery, SessionRef};
use broski_link_testkit::WAIT;
use common::{
    choose, create_session, inbox_until, listed, paired, phone, phone_with, prompt, requests_sent,
    status_until, Mac, Watched,
};
use tokio::time::{timeout, timeout_at, Instant};

fn state(rows: &[InboxRow], session: &SessionRef) -> Option<InboxState> {
    rows.iter()
        .find(|row| &row.session == session)
        .map(|row| row.state)
}

fn position(rows: &[InboxRow], session: &SessionRef) -> usize {
    rows.iter()
        .position(|row| &row.session == session)
        .expect("listed")
}

fn in_state(session: &SessionRef, wanted: InboxState) -> impl Fn(&[InboxRow]) -> bool {
    let session = session.clone();
    move |rows| state(rows, &session) == Some(wanted)
}

/// Two machines on one phone; the first had a session before the phone paired with it.
struct Desk {
    first: Mac,
    second: Mac,
    phone: Phone,
    machine_a: Arc<Machine>,
    machine_b: Arc<Machine>,
    history: SessionRef,
}

async fn desk() -> Desk {
    let mut first = Mac::on_lan().await;
    let second = Mac::on_lan().await;
    let history = first.bridge.seed(&first.root(), "Last week").await;
    let phone = phone();
    let machine_a = paired(&phone, &first).await;
    let machine_b = paired(&phone, &second).await;
    Desk {
        first,
        second,
        phone,
        machine_a,
        machine_b,
        history,
    }
}

/// Picks an answer to the ask `chat` waits on.
async fn answer_the_ask(machine: &Machine, session: &SessionRef, chat: &mut Watched) {
    let asked = |replica: &common::replica::Replica| !replica.snapshot.interactions.is_empty();
    chat.until("the ask", asked).await;
    let interaction = chat.replica.snapshot.interactions[0].id.clone();
    let answered = machine.request(choose(session, interaction)).await;
    answered.expect("answered");
}

/// The person sees `session` on `machine`; returns the marker the app persists.
fn see(desk: &Desk, machine: &Machine, session: &SessionRef) -> Option<i64> {
    let inbox = desk.phone.inbox();
    inbox.mark_seen(machine.id(), session.clone());
    let marker = inbox
        .seen()
        .markers
        .into_iter()
        .find(|marker| &marker.session == session);
    marker.map(|marker| marker.seen_at)
}

/// Pulls the inbox's updates until one carries a seen state that satisfies `done`: what the app
/// persists.
async fn persisted_until(
    phone: &Phone,
    what: &str,
    done: impl Fn(&SeenState) -> bool,
) -> SeenState {
    let deadline = Instant::now() + WAIT;
    loop {
        let update = timeout_at(deadline, phone.inbox().next_change())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
        if let Some(seen) = update.seen.filter(&done) {
            return seen;
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_marked_unread_is_done_across_a_restart_until_it_is_seen() {
    let mut mac = Mac::on_lan().await;
    let history = mac.bridge.seed(&mac.root(), "Last week").await;
    let secret = new_identity_secret().expect("a secret");
    let first = phone_with(secret.clone());
    let machine = paired(&first, &mac).await;
    inbox_until(
        &first,
        "the history seen",
        in_state(&history, InboxState::Idle),
    )
    .await;

    first.inbox().mark_unread(machine.id(), history.clone());
    let unread = [UnreadSession {
        machine_id: machine.id(),
        session: history.clone(),
    }];
    let persisted = persisted_until(&first, "the unread mark", |seen| seen.unread == unread).await;
    assert!(
        !persisted
            .markers
            .iter()
            .any(|marker| marker.session == history),
        "no longer marked seen"
    );
    let rows = first.inbox().rows();
    assert_eq!(state(&rows, &history), Some(InboxState::Done));
    let record = machine.record();
    drop((machine, first));

    let second = phone_with(secret);
    second.inbox().restore_seen(persisted);
    let machine = second.start(record).expect("started");
    let done = in_state(&history, InboxState::Done);
    inbox_until(&second, "the unread session after a restart", done).await;
    assert_eq!(second.inbox().seen().unread, unread);

    second.inbox().mark_seen(machine.id(), history.clone());
    inbox_until(
        &second,
        "the opened session",
        in_state(&history, InboxState::Idle),
    )
    .await;
    assert!(second.inbox().seen().unread.is_empty());

    second.inbox().mark_unread(machine.id(), history.clone());
    second.forget(machine.id());
    assert!(second.inbox().seen().unread.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_machine_paired_for_the_first_time_shows_its_history_as_seen() {
    let desk = desk().await;
    let history = in_state(&desk.history, InboxState::Idle);
    inbox_until(&desk.phone, "the first machine's history", history).await;
    let seen = desk.phone.inbox().seen();
    let marked = seen
        .markers
        .iter()
        .any(|marker| marker.session == desk.history && marker.machine_id == desk.machine_a.id());
    assert!(marked, "a marker the app persists");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sessions_move_through_needs_you_working_done_and_idle_across_machines() {
    let mut desk = desk().await;
    let working = create_session(&desk.machine_a, &desk.first.root()).await;
    let asking = create_session(&desk.machine_b, &desk.second.root()).await;
    let mut chat = Watched::attach(&desk.machine_b, &asking);
    desk.first.bridge.script(&working, "hold").await;
    desk.second.bridge.script(&asking, "ask").await;
    let prompting = Watched::attach(&desk.machine_a, &working);
    prompt(&desk.machine_a, &working, PromptMode::Start, "Work on it").await;
    // Unviewed, the working session's state comes from its catalog row, the asking one's live.
    drop(prompting);
    prompt(&desk.machine_b, &asking, PromptMode::Start, "Ask me").await;

    let needs_you = in_state(&asking, InboxState::NeedsYou);
    let busy = in_state(&working, InboxState::Working);
    let rows = inbox_until(&desk.phone, "one asking, one working", |rows| {
        needs_you(rows) && busy(rows)
    })
    .await;
    assert!(position(&rows, &asking) < position(&rows, &working));
    assert!(position(&rows, &working) < position(&rows, &desk.history));
    let asked = &rows[position(&rows, &asking)];
    assert_eq!(asked.ask.as_deref(), Some("Pick one"));
    assert_eq!(asked.machine_id, desk.machine_b.id());

    desk.first.bridge.release(&working).await;
    let released = in_state(&working, InboxState::Done);
    inbox_until(&desk.phone, "the released run done", released).await;
    answer_the_ask(&desk.machine_b, &asking, &mut chat).await;
    let finished = in_state(&asking, InboxState::Done);
    let rows = inbox_until(&desk.phone, "the answered run done", finished).await;
    assert_eq!(state(&rows, &working), Some(InboxState::Done));
    assert!(
        position(&rows, &asking) < position(&rows, &working),
        "newest first"
    );

    let seen_at = see(&desk, &desk.machine_a, &working);
    let seen = in_state(&working, InboxState::Idle);
    let rows = inbox_until(&desk.phone, "the seen session idle", seen).await;
    assert_eq!(seen_at, Some(rows[position(&rows, &working)].updated_at));
    assert_eq!(state(&rows, &asking), Some(InboxState::Done));

    desk.phone.inbox().mark_all_seen();
    let all_seen = in_state(&asking, InboxState::Idle);
    let rows = inbox_until(&desk.phone, "every done session marked seen", all_seen).await;
    assert_eq!(state(&rows, &working), Some(InboxState::Idle));
}

/// A session the person opens the moment it exists (New session opens its chat at once) is not in
/// the machine's lists yet: the mark waits for its row, and the row comes in seen.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_seen_before_its_row_arrives_comes_in_idle() {
    let mut mac = Mac::on_lan().await;
    let history = mac.bridge.seed(&mac.root(), "Last week").await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    inbox_until(&phone, "the history", in_state(&history, InboxState::Idle)).await;

    let opened = mac.bridge.seed(&mac.root(), "Just created").await;
    phone.inbox().mark_seen(machine.id(), opened.clone());
    let rows = inbox_until(&phone, "the new row", |rows| state(rows, &opened).is_some()).await;
    assert_eq!(state(&rows, &opened), Some(InboxState::Idle));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_session_that_appears_before_the_ui_reads_the_inbox_is_still_done() {
    let mut mac = Mac::on_lan().await;
    let history = mac.bridge.seed(&mac.root(), "Last week").await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    // Nothing reads the inbox, so the history is marked only if the inbox settles by itself. The
    // marker is state, not an update, so it is polled for.
    let deadline = Instant::now() + WAIT;
    while !(phone.inbox().seen().markers)
        .iter()
        .any(|marker| marker.session == history)
    {
        assert!(Instant::now() < deadline, "the history was never marked");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let query = SessionQuery {
        cwd: None,
        parent: None,
    };
    let list = Arc::clone(&machine)
        .session_list("pi".to_owned(), query)
        .expect("a list");

    let news = mac.bridge.seed(&mac.root(), "Finished meanwhile").await;
    listed(&list, &news).await;
    let rows = inbox_until(&phone, "the first read", in_state(&news, InboxState::Done)).await;
    assert_eq!(state(&rows, &history), Some(InboxState::Idle));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_machine_with_no_history_at_its_first_read_is_not_marked_again_at_the_next_start() {
    let mut mac = Mac::on_lan().await;
    let secret = new_identity_secret().expect("a secret");
    let first = phone_with(secret.clone());
    let machine = paired(&first, &mac).await;
    let record = machine.record();
    let deadline = Instant::now() + WAIT;
    let persisted = loop {
        let update = timeout_at(deadline, first.inbox().next_change())
            .await
            .expect("the first read to be persisted");
        if let Some(seen) = update.seen {
            break seen;
        }
    };
    drop((machine, first));

    let finished = mac.bridge.seed(&mac.root(), "Finished while closed").await;
    let second = phone_with(secret);
    second.inbox().restore_seen(persisted);
    second.start(record).expect("started");
    let done = in_state(&finished, InboxState::Done);
    inbox_until(
        &second,
        "the session finished while the app was closed",
        done,
    )
    .await;
}

/// Pull to refresh sends one first-page request per inbox list, and a machine whose link waits to
/// dial, which would only hold the requests, does not keep it waiting.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_refresh_reloads_each_list_once_and_skips_a_machine_that_is_not_ready() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let seeded = mac.bridge.seed(&mac.root(), "Seeded").await;
    inbox_until(&phone, "the seeded session", |rows| {
        state(rows, &seeded).is_some()
    })
    .await;

    let before = requests_sent(&machine).await;
    phone.inbox().refresh().await;
    let after = requests_sent(&machine).await;
    assert_eq!(
        after - before,
        2,
        "Pi's one list reloaded, then the count's own request"
    );

    mac.stop_daemon().await;
    let waiting = |status: &MachineStatus| matches!(status.link.state, LinkState::Waiting(_));
    status_until(&machine, "the link to wait for the machine", waiting).await;
    timeout(Duration::from_secs(5), phone.inbox().refresh())
        .await
        .expect("a refresh that holds no request");
}
