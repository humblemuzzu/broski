//! The exported API driven as an app drives it, against the real daemon and the real bridge
//! (`broski-link-testkit`): pairing from a scanned offer, a chat whose UI copy equals the view's
//! snapshot, the inbox with its seen markers and its cache, a session list, a terminal, and an app
//! that starts again from what it stored and shows its last inbox before the machine answers.

#[path = "../../client/tests/common/replica.rs"]
mod replica;

use std::sync::Arc;

use broski_client::{
    ClientError, ContractState, InboxRow, InboxState, MachineStatus, PhoneConfig, SeenState,
    TerminalUpdate,
};
use broski_contract::{
    ActionResult, BackendsListRequest, ClientMessage, NewSessionOptions, NewSessionResult,
    PromptInput, PromptMode, PromptRequest, PromptResult, RunOutcome, ServerMessage,
    SessionCreateRequest, SessionQuery, SessionRef, TermOpenRequest, TermOpenResult,
};
use broski_core::{
    new_identity_secret, parse_pairing_offer, Inbox, Machine, MachineRecord, Phone, SessionList,
    SessionView, TerminalView,
};
use broski_link_session::Platform;
use broski_link_testkit::mac::Mac;
use broski_link_testkit::WAIT;
use replica::Replica;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{timeout_at, Instant};

fn config() -> PhoneConfig {
    PhoneConfig {
        device_name: "Test Phone".into(),
        platform: Platform::Android,
        client_name: "broski-mobile tests".into(),
        client_version: "0.0.0".into(),
    }
}

fn ready(status: &MachineStatus) -> bool {
    matches!(status.contract, ContractState::Ready { .. })
}

/// Pulls the machine's events until its status satisfies `done`.
async fn events_until(machine: &Machine, what: &str, done: impl Fn(&MachineStatus) -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done(&machine.status()) {
        match timeout_at(deadline, machine.next_event()).await {
            Ok(Some(_)) => {}
            Ok(None) => panic!("the machine ended while waiting for {what}"),
            Err(_) => panic!("timed out waiting for {what}: {:?}", machine.status()),
        }
    }
}

/// The answer to `message` as `read` takes it out; any other answer fails the test, naming it.
async fn answer<T>(
    machine: &Machine,
    message: ClientMessage,
    read: impl FnOnce(ServerMessage) -> Option<T>,
) -> T {
    let answer = machine.request(message).await.expect("an answer");
    let shown = format!("{answer:?}");
    read(answer).unwrap_or_else(|| panic!("not the answer expected: {shown}"))
}

async fn create_session(machine: &Machine, cwd: String) -> SessionRef {
    let create = ClientMessage::SessionCreate(SessionCreateRequest {
        request_id: String::new(),
        backend: "pi".to_owned(),
        options: NewSessionOptions {
            cwd,
            model_id: None,
            thinking: None,
            modes: None,
        },
    });
    answer(machine, create, |answer| match answer {
        ServerMessage::SessionCreateResult(answer) => match answer.result {
            NewSessionResult::Accepted(accepted) => Some(accepted.session),
            NewSessionResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await
}

async fn prompt(machine: &Machine, session: &SessionRef, text: &str) {
    let prompt = ClientMessage::Prompt(PromptRequest {
        request_id: String::new(),
        session: session.clone(),
        input: PromptInput {
            client_request_id: "00000000-0000-4000-8000-000000000001".into(),
            mode: PromptMode::Start,
            text: text.into(),
            attachments: Vec::new(),
            command: None,
        },
    });
    answer(machine, prompt, |answer| match answer {
        ServerMessage::PromptResult(answer) => match answer.result {
            PromptResult::Accepted(_) => Some(()),
            PromptResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await;
}

/// Applies the view's updates as a UI does until its copy satisfies `done`.
async fn updates_until(view: &SessionView, ui: &mut Replica, done: impl Fn(&Replica) -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done(ui) {
        match timeout_at(deadline, view.next_update()).await {
            Ok(Some(update)) => ui.apply(update),
            Ok(None) => panic!("the view ended"),
            Err(_) => panic!("timed out at {:?}", ui.snapshot),
        }
    }
}

/// A run streams into a view as change records, and the UI's copy is then the view's snapshot.
async fn chat(machine: &Machine, mac: &mut Mac, session: &SessionRef) {
    let view = machine.attach(session.clone()).expect("a view");
    let mut ui = Replica::default();
    updates_until(&view, &mut ui, |ui| ui.resets == 1).await;
    mac.bridge.script(session, "work").await;
    prompt(machine, session, "Read the notes").await;
    let finished = |ui: &Replica| ui.snapshot.run.is_none() && ui.snapshot.last_outcome.is_some();
    updates_until(&view, &mut ui, finished).await;
    assert_eq!(
        ui.snapshot.last_outcome,
        Some(RunOutcome::Completed(broski_contract::RunCompleted {}))
    );
    assert!(ui.batches > 0 && ui.resets == 1, "the run came as records");
    assert!(ui.snapshot == view.snapshot().expect("attached"));
    view.detach();
    assert_eq!(
        view.next_update().await,
        None,
        "a detached view ends its pull"
    );
}

/// The home screen's loop, as the app runs it for its whole life.
struct HomeScreen {
    /// The rows of every update.
    shown: watch::Receiver<Vec<InboxRow>>,
    /// The newest cache it was handed to persist.
    persisted: watch::Receiver<Option<Vec<u8>>>,
    pulling: JoinHandle<()>,
}

fn home_screen(inbox: Arc<Inbox>) -> HomeScreen {
    let (rows, shown) = watch::channel(inbox.rows());
    let (cache, persisted) = watch::channel(None);
    let pulling = tokio::spawn(async move {
        loop {
            let update = inbox.next_change().await;
            if update.cache.is_some() {
                let _ = cache.send(update.cache);
            }
            let _ = rows.send(update.rows);
        }
    });
    HomeScreen {
        shown,
        persisted,
        pulling,
    }
}

async fn inbox_until(
    shown: &mut watch::Receiver<Vec<InboxRow>>,
    what: &str,
    done: impl Fn(&[InboxRow]) -> bool,
) {
    let deadline = Instant::now() + WAIT;
    let in_time = matches!(
        timeout_at(deadline, shown.wait_for(|rows| done(rows))).await,
        Ok(Ok(_))
    );
    assert!(
        in_time,
        "timed out waiting for {what}: {:?}",
        *shown.borrow()
    );
}

fn in_state(session: &SessionRef, state: InboxState) -> impl Fn(&[InboxRow]) -> bool {
    let session = session.clone();
    move |rows| {
        rows.iter()
            .any(|row| row.session == session && row.state == state)
    }
}

/// The finished run is news on the home screen until the person looks; returns what the app
/// persists.
async fn see(
    phone: &Phone,
    shown: &mut watch::Receiver<Vec<InboxRow>>,
    machine: &Machine,
    session: &SessionRef,
) -> SeenState {
    inbox_until(shown, "the run done", in_state(session, InboxState::Done)).await;
    phone.inbox().mark_seen(machine.id(), session.clone());
    inbox_until(shown, "the run seen", in_state(session, InboxState::Idle)).await;
    let seen = phone.inbox().seen();
    assert!(seen.markers.iter().any(|marker| &marker.session == session));
    assert_eq!(seen.read_machines, [machine.id()]);
    seen
}

async fn listed(list: &SessionList, session: &SessionRef) {
    let deadline = Instant::now() + WAIT;
    let mut rows = list.rows();
    while !rows.rows.iter().any(|row| &row.session == session) {
        rows = timeout_at(deadline, list.next_change())
            .await
            .expect("the list in time")
            .expect("the list goes on");
    }
    list.stop();
    assert_eq!(
        list.next_change().await,
        None,
        "a stopped list ends its pull"
    );
}

async fn open_terminal(machine: &Arc<Machine>, cwd: String) -> Arc<TerminalView> {
    let open = ClientMessage::TermOpen(TermOpenRequest {
        request_id: String::new(),
        cwd,
        cols: 80,
        rows: 24,
        cell_width: None,
        cell_height: None,
    });
    let id = answer(machine, open, |answer| match answer {
        ServerMessage::TermOpenResult(answer) => match answer.result {
            TermOpenResult::Accepted(opened) => Some(opened.terminal.id),
            TermOpenResult::Rejected(_) => None,
        },
        _ => None,
    })
    .await;
    machine.terminal(id).expect("a terminal view")
}

/// A shell echoes what the emulator types and takes a resize.
async fn terminal(machine: &Arc<Machine>, cwd: String) {
    let view = open_terminal(machine, cwd).await;
    let typed = view.input(b"echo broski-$((6*7))\n".to_vec()).await;
    assert!(matches!(typed, Ok(ActionResult::Accepted(_))), "{typed:?}");
    let deadline = Instant::now() + WAIT;
    let mut screen = Vec::new();
    while !String::from_utf8_lossy(&screen).contains("broski-42\r\n") {
        match timeout_at(deadline, view.next_update()).await {
            Ok(Some(TerminalUpdate::Output { data, .. })) => screen.extend(data),
            other => panic!("waiting for the echo: {other:?}"),
        }
    }
    let resized = view.resize(100, 30, Some(8), Some(16)).await;
    assert!(matches!(resized, Ok(ActionResult::Accepted(_))));
    view.detach();
    assert_eq!(
        view.next_update().await,
        None,
        "a detached terminal ends its pull"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_app_pairs_chats_and_finds_it_all_again_after_a_restart() {
    let mut mac = Mac::on_lan().await;
    let secret = new_identity_secret().expect("a secret");
    let offer = mac.offer().await;
    let scanned = parse_pairing_offer(offer.clone()).expect("an offer");
    let phone = Phone::new(secret.clone(), config()).expect("a phone");
    let mut home = home_screen(phone.inbox());
    let machine = phone.pair(offer).await.expect("paired");
    assert_eq!(scanned.machine_id, machine.id());
    let stored = machine.record().to_bytes();
    events_until(&machine, "the bridge to agree on the protocol", ready).await;

    let session = create_session(&machine, mac.root_text()).await;
    chat(&machine, &mut mac, &session).await;
    let seen = see(&phone, &mut home.shown, &machine, &session).await;
    let query = SessionQuery {
        cwd: Some(mac.root_text()),
        parent: None,
        search: None,
    };
    let list = machine
        .session_list("pi".to_owned(), query)
        .expect("a list");
    listed(&list, &session).await;
    terminal(&machine, mac.root_text()).await;
    // The cache is the app's opaque bytes; JSON inside, which is how the test knows it is current.
    let current = |cache: &Option<Vec<u8>>| {
        let text = String::from_utf8_lossy(cache.as_deref().unwrap_or_default()).into_owned();
        text.contains(&session.session_id) && text.contains("\"state\":\"idle\"")
    };
    let cached = home.persisted.wait_for(current);
    let cache = timeout_at(Instant::now() + WAIT, cached)
        .await
        .expect("a cache in time")
        .expect("the loop runs")
        .clone()
        .expect("a cache");
    home.pulling.abort();
    drop((list, machine, phone));

    let phone = Phone::new(secret, config()).expect("the phone again");
    phone.inbox().restore_seen(seen);
    phone
        .inbox()
        .restore_cache(cache)
        .expect("the cache restores");
    let record = MachineRecord::from_bytes(stored).expect("the stored record");
    let machine = phone.start(record).expect("started");
    let first = phone.inbox().rows();
    let last_known = first.iter().find(|row| row.session == session);
    assert!(
        last_known.is_some_and(|row| row.cached && row.state == InboxState::Idle),
        "the last inbox shows before the machine answers: {first:?}"
    );
    let mut home = home_screen(phone.inbox());
    events_until(&machine, "the bridge again", ready).await;
    let live = in_state(&session, InboxState::Idle);
    inbox_until(
        &mut home.shown,
        "the seen session after the restart",
        |rows| live(rows) && rows.iter().all(|row| !row.cached),
    )
    .await;
    home.pulling.abort();

    phone.forget(machine.id());
    while timeout_at(Instant::now() + WAIT, machine.next_event())
        .await
        .expect("the machine ends")
        .is_some()
    {}
    let backends = ClientMessage::BackendsList(BackendsListRequest {
        request_id: String::new(),
    });
    assert_eq!(machine.request(backends).await, Err(ClientError::Closed));
}
