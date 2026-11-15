//! A chat through the real daemon and the real bridge: a run streams into a view, an ask is
//! answered, queued and steered input lands, Stop ends the run, and the UI's copy is the view's.

mod common;

use broski_client::{SessionChange, SessionUpdate};
use broski_contract::{
    AbortRequest, ActionResult, BackendId, ClientMessage, InteractionAnswer,
    InteractionAnswerRequest, InteractionReply, InteractionRequest, PageRequest, PermissionPreview,
    PromptDisposition, PromptMode, PromptResult, QueueCancelRequest, RejectionCode, RunOutcome,
    ServerMessage, SessionRef, SessionStatus, ToolOutcome, ToolPermissionReply, TranscriptItem,
    TranscriptReadRequest, TranscriptReadResult,
};
use common::replica::Replica;
use common::{create_session, paired, phone, prompt, run_texts, Mac, Watched};

fn finished(replica: &Replica) -> bool {
    replica.snapshot.run.is_none() && replica.snapshot.last_outcome.is_some()
}

fn disposition(result: &PromptResult) -> Option<PromptDisposition> {
    match result {
        PromptResult::Accepted(accepted) => Some(accepted.disposition),
        PromptResult::Rejected(_) => None,
    }
}

fn allow_once(session: &SessionRef, interaction_id: String) -> ClientMessage {
    ClientMessage::InteractionAnswer(InteractionAnswerRequest {
        request_id: String::new(),
        session: session.clone(),
        answer: InteractionAnswer {
            interaction_id,
            reply: InteractionReply::ToolPermission(ToolPermissionReply {
                option_id: "allow_once".to_owned(),
                message: None,
                edited_input: None,
                grant_ids: Vec::new(),
            }),
        },
    })
}

async fn answered(machine: &broski_client::Machine, answer: ClientMessage) -> ActionResult {
    match machine.request(answer).await.expect("an answer") {
        ServerMessage::InteractionAnswerResult(answer) => answer.result,
        other => panic!("{other:?}"),
    }
}

async fn stop(machine: &broski_client::Machine, session: &SessionRef) {
    let abort = ClientMessage::Abort(AbortRequest {
        request_id: String::new(),
        session: session.clone(),
    });
    let result = match machine.request(abort).await.expect("an answer") {
        ServerMessage::AbortResult(answer) => answer.result,
        other => panic!("{other:?}"),
    };
    assert!(matches!(result, ActionResult::Accepted(_)), "{result:?}");
}

async fn newest_transcript(
    machine: &broski_client::Machine,
    session: &SessionRef,
) -> Vec<TranscriptItem> {
    let request = ClientMessage::TranscriptRead(TranscriptReadRequest {
        request_id: String::new(),
        session: session.clone(),
        page: PageRequest {
            cursor: None,
            limit: 200,
        },
    });
    match machine.request(request).await.expect("an answer") {
        ServerMessage::TranscriptReadResult(answer) => match answer.result {
            TranscriptReadResult::Accepted(read) => read.page.items,
            TranscriptReadResult::Rejected(rejected) => panic!("{rejected:?}"),
        },
        other => panic!("{other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_run_streams_into_the_view_and_the_ui_holds_the_views_snapshot() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let backends = machine.backends().await.expect("the backends");
    assert_eq!(
        backends
            .iter()
            .map(|backend| backend.id)
            .collect::<Vec<_>>(),
        [BackendId::Pi]
    );

    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    assert!(matches!(chat.next().await, SessionUpdate::Reset { .. }));
    mac.bridge.script(&session, "work").await;
    let started = prompt(&machine, &session, PromptMode::Start, "Read the notes").await;
    assert_eq!(disposition(&started), Some(PromptDisposition::Started));

    chat.until("the run to finish", finished).await;
    chat.assert_equal("after the run");
    assert_eq!(
        chat.replica.resets, 1,
        "the whole run came as change records"
    );
    assert_eq!(
        chat.replica.snapshot.last_outcome,
        Some(RunOutcome::Completed(broski_contract::RunCompleted {}))
    );
    assert!(chat.replica.moments.iter().any(|moment| matches!(
        moment,
        SessionChange::NoticeShown { notice } if notice.text == "Halfway there."
    )));
    let transcript = newest_transcript(&machine, &session).await;
    let last_paragraph = transcript.iter().any(|item| {
        matches!(item, TranscriptItem::Block(block) if block.text.starts_with("Paragraph 24:"))
    });
    assert!(last_paragraph, "the finished run is in the transcript");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_permission_ask_is_answered_once_and_the_run_finishes() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    mac.bridge.script(&session, "permission").await;
    prompt(&machine, &session, PromptMode::Start, "Clean the build").await;

    chat.until("the permission ask", |replica| {
        !replica.snapshot.interactions.is_empty()
    })
    .await;
    assert_eq!(chat.replica.status, Some(SessionStatus::WaitingForUser));
    let ask = chat.replica.snapshot.interactions[0].clone();
    let InteractionRequest::ToolPermission(request) = &ask.request else {
        panic!("a tool permission: {ask:?}");
    };
    assert!(request.previews.iter().any(|preview| matches!(
        preview,
        PermissionPreview::Command(command) if command.command == "rm -rf build"
    )));
    chat.assert_equal("while the ask waits");

    let answer = allow_once(&session, ask.id.clone());
    let first = answered(&machine, answer.clone()).await;
    assert!(matches!(first, ActionResult::Accepted(_)), "{first:?}");
    chat.until("the run to finish", finished).await;
    chat.assert_equal("after the run");
    assert!(chat.replica.snapshot.interactions.is_empty());

    let again = answered(&machine, answer).await;
    assert!(
        matches!(again, ActionResult::Rejected(ref rejected) if rejected.rejection.code == RejectionCode::Stale),
        "a second answer is stale: {again:?}"
    );
    let transcript = newest_transcript(&machine, &session).await;
    assert!(transcript.iter().any(|item| matches!(
        item,
        TranscriptItem::ToolResult(result) if result.outcome == ToolOutcome::Completed
    )));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queued_and_steered_input_land_and_stop_ends_the_run() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    mac.bridge.script(&session, "hold").await;
    prompt(&machine, &session, PromptMode::Start, "Work on it").await;
    chat.until("the run to hold", |replica| {
        run_texts(replica) == ["Working."]
    })
    .await;

    let queued = prompt(&machine, &session, PromptMode::Queue, "Then this").await;
    let PromptResult::Accepted(queued) = queued else {
        panic!("queued input is accepted");
    };
    assert_eq!(queued.disposition, PromptDisposition::Queued);
    let steered = prompt(&machine, &session, PromptMode::Steer, "And mind this").await;
    assert_eq!(disposition(&steered), Some(PromptDisposition::Steered));
    let busy = prompt(&machine, &session, PromptMode::Start, "Another run").await;
    assert!(
        matches!(busy, PromptResult::Rejected(ref rejected) if rejected.rejection.code == RejectionCode::Busy)
    );
    chat.until("both inputs in the queue", |replica| {
        replica.snapshot.queue.len() == 2
    })
    .await;
    chat.assert_equal("while the run holds");

    let cancel = ClientMessage::QueueCancel(QueueCancelRequest {
        request_id: String::new(),
        session: session.clone(),
        queue_item_id: queued.queue_item_id.expect("a queue item id"),
    });
    machine.request(cancel).await.expect("cancelled");
    let one_left = |replica: &Replica| replica.snapshot.queue.len() == 1;
    chat.until("the queued input to leave", one_left).await;
    stop(&machine, &session).await;
    chat.until("the run to end", finished).await;
    assert_eq!(
        chat.replica.snapshot.last_outcome,
        Some(RunOutcome::Aborted(broski_contract::RunAborted {}))
    );
    chat.assert_equal("after Stop");
}
