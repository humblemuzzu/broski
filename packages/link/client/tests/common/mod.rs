#![allow(dead_code)]

pub mod replica;

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Once};
use std::time::Duration;

use broski_client::{
    new_identity_secret, ContractState, InboxRow, InboxUpdate, Machine, MachineStatus, Phone,
    PhoneConfig, Platform, SessionUpdate, SessionView, Timings,
};
use broski_contract::{
    BackendId, ChoiceReply, ClientMessage, InteractionAnswer, InteractionAnswerRequest,
    InteractionReply, NewSessionOptions, NewSessionResult, PromptInput, PromptMode, PromptRequest,
    PromptResult, ServerMessage, SessionCreateRequest, SessionRef, TranscriptItem,
};
pub use broski_link_testkit::mac::Mac;
use broski_link_testkit::WAIT;
use tokio::time::{timeout_at, Instant};

use self::replica::Replica;

pub fn init_logs() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let filter = tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("off"));
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_test_writer()
            .try_init();
    });
}

/// The production windows, with the ones a test would otherwise wait out shrunk.
fn quick() -> Timings {
    Timings {
        probe_interval: Duration::from_millis(200),
        backoff_min: Duration::from_millis(50),
        backoff_max: Duration::from_millis(500),
        ..Timings::default()
    }
}

pub fn phone() -> Phone {
    init_logs();
    let config = PhoneConfig {
        device_name: "test phone".to_owned(),
        platform: Platform::Ios,
        client_name: "broski-client tests".to_owned(),
        client_version: "0.0.0".to_owned(),
    };
    Phone::with_timings(new_identity_secret().expect("secret"), config, quick()).expect("phone")
}

/// Pairs and waits until the bridge has agreed on the protocol.
pub async fn paired(phone: &Phone, mac: &Mac) -> Arc<Machine> {
    pair_with(phone, mac.offer().await).await
}

pub async fn pair_with(phone: &Phone, offer: String) -> Arc<Machine> {
    let paired = phone.pair(offer).await.expect("the phone pairs");
    status_until(
        &paired.machine,
        "the bridge to agree on the protocol",
        ready,
    )
    .await;
    paired.machine
}

pub fn ready(status: &MachineStatus) -> bool {
    matches!(status.contract, ContractState::Ready { .. })
}

/// Pulls the machine's events until its status satisfies `done`; the events are the clock.
pub async fn status_until(machine: &Machine, what: &str, done: impl Fn(&MachineStatus) -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done(&machine.status()) {
        match timeout_at(deadline, machine.next_event()).await {
            Ok(Some(_)) => {}
            Ok(None) => panic!("the machine ended while waiting for {what}"),
            Err(_) => panic!("timed out waiting for {what}: {:?}", machine.status()),
        }
    }
}

pub async fn create_session(machine: &Machine, cwd: &Path) -> SessionRef {
    let request = ClientMessage::SessionCreate(SessionCreateRequest {
        request_id: String::new(),
        backend: BackendId::Pi,
        options: NewSessionOptions {
            cwd: cwd.to_string_lossy().into_owned(),
            model_id: None,
            thinking: None,
            modes: None,
        },
    });
    match machine.request(request).await.expect("an answer") {
        ServerMessage::SessionCreateResult(answer) => match answer.result {
            NewSessionResult::Accepted(accepted) => accepted.session,
            NewSessionResult::Rejected(rejected) => panic!("{rejected:?}"),
        },
        other => panic!("{other:?}"),
    }
}

/// A fresh `clientRequestId`, a UUID as the contract asks.
pub fn client_request_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let next = NEXT.fetch_add(1, Ordering::Relaxed);
    format!("00000000-0000-4000-8000-{next:012}")
}

pub async fn prompt(
    machine: &Machine,
    session: &SessionRef,
    mode: PromptMode,
    text: &str,
) -> PromptResult {
    let request = ClientMessage::Prompt(PromptRequest {
        request_id: String::new(),
        session: session.clone(),
        input: PromptInput {
            client_request_id: client_request_id(),
            mode,
            text: text.to_owned(),
            attachments: Vec::new(),
            command: None,
        },
    });
    match machine.request(request).await.expect("an answer") {
        ServerMessage::PromptResult(answer) => answer.result,
        other => panic!("{other:?}"),
    }
}

/// The answer to `request` as `read` takes it out; any other answer fails the test, naming it.
pub async fn answer<T>(
    machine: &Machine,
    request: ClientMessage,
    read: impl FnOnce(ServerMessage) -> Option<T>,
) -> T {
    let answer = machine.request(request).await.expect("an answer");
    let shown = format!("{answer:?}");
    read(answer).unwrap_or_else(|| panic!("not the answer expected: {shown}"))
}

/// Picks `retry` in the session's pending choice.
pub fn choose(session: &SessionRef, interaction_id: String) -> ClientMessage {
    ClientMessage::InteractionAnswer(InteractionAnswerRequest {
        request_id: String::new(),
        session: session.clone(),
        answer: InteractionAnswer {
            interaction_id,
            reply: InteractionReply::Choice(ChoiceReply {
                value: "retry".to_owned(),
            }),
        },
    })
}

/// A view and the UI's copy of it.
pub struct Watched {
    pub view: Arc<SessionView>,
    pub replica: Replica,
}

impl Watched {
    pub fn attach(machine: &Arc<Machine>, session: &SessionRef) -> Watched {
        let view = Arc::clone(machine).attach(session.clone()).expect("a view");
        Watched {
            view,
            replica: Replica::default(),
        }
    }

    /// Applies updates as a UI does until the UI's copy satisfies `done`.
    pub async fn until(&mut self, what: &str, done: impl Fn(&Replica) -> bool) {
        let deadline = Instant::now() + WAIT;
        while !done(&self.replica) {
            match timeout_at(deadline, self.view.next_update()).await {
                Ok(Some(update)) => self.replica.apply(update),
                Ok(None) => panic!("the view ended while waiting for {what}"),
                Err(_) => panic!("timed out waiting for {what}: {:?}", self.replica.snapshot),
            }
        }
    }

    pub async fn next(&mut self) -> SessionUpdate {
        let update = timeout_at(Instant::now() + WAIT, self.view.next_update())
            .await
            .expect("an update in time")
            .expect("the view goes on");
        self.replica.apply(update.clone());
        update
    }

    /// The UI's copy is the view's snapshot, entry for entry.
    pub fn assert_equal(&self, place: &str) {
        let snapshot = self.view.snapshot().expect("attached");
        assert!(
            self.replica.snapshot == snapshot,
            "{place}: the UI's copy differs\n  ui:   {:?}\n  view: {snapshot:?}",
            self.replica.snapshot
        );
    }
}

/// The finished blocks' texts in the active run, in order.
pub fn run_texts(replica: &Replica) -> Vec<String> {
    replica
        .snapshot
        .run
        .iter()
        .flat_map(|run| &run.items)
        .filter_map(|item| match item {
            TranscriptItem::Block(block) => Some(block.text.clone()),
            _ => None,
        })
        .collect()
}

/// Pulls the inbox's changes until its rows satisfy `done`.
pub async fn inbox_until(
    phone: &Phone,
    what: &str,
    done: impl Fn(&[InboxRow]) -> bool,
) -> Vec<InboxRow> {
    let inbox = phone.inbox();
    let deadline = Instant::now() + WAIT;
    let mut rows = inbox.rows();
    while !done(&rows) {
        let update: InboxUpdate = timeout_at(deadline, inbox.next_change())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {what}: {rows:?}"));
        rows = update.rows;
    }
    rows
}
