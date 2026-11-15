//! The inbox over two real machines: a session waiting on the person comes first, then one that
//! works, then one that finished unseen, then the rest; seeing a session makes it idle.

mod common;

use std::sync::Arc;

use broski_client::{InboxRow, InboxState, Machine, Phone};
use broski_contract::{PromptMode, SessionRef};
use common::{choose, create_session, inbox_until, paired, phone, prompt, Mac, Watched};

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
        .into_iter()
        .find(|marker| &marker.session == session);
    marker.map(|marker| marker.seen_at)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_machine_paired_for_the_first_time_shows_its_history_as_seen() {
    let desk = desk().await;
    let history = in_state(&desk.history, InboxState::Idle);
    inbox_until(&desk.phone, "the first machine's history", history).await;
    let seen = desk.phone.inbox().seen();
    let marked = seen
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
}
