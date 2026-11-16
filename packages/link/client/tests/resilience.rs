//! Views across links that drop, bridges that restart and machines that start over, against the
//! real daemon, relay and bridge: nothing lost, nothing applied twice, the UI's copy the view's.

mod common;

use broski_client::{LinkState, Machine, MachineStatus};
use broski_contract::{
    BackendsListRequest, ClientMessage, PageRequest, PromptMode, PromptResult, ServerMessage,
    SessionRef, TranscriptItem, TranscriptReadRequest, TranscriptReadResult,
};
use broski_link_testkit::relay::TestRelay;
use common::replica::Replica;
use common::{
    choose, create_session, pair_with, paired, phone, prompt, ready, run_texts, status_until, Mac,
    Watched,
};

fn finished(replica: &Replica) -> bool {
    replica.snapshot.run.is_none() && replica.snapshot.last_outcome.is_some()
}

fn holding(replica: &Replica) -> bool {
    run_texts(replica) == ["Working."]
}

fn connected(status: &MachineStatus) -> bool {
    matches!(status.link.state, LinkState::Connected { .. })
}

fn asked(replica: &Replica) -> bool {
    !replica.snapshot.interactions.is_empty()
}

/// The phone behind `mac`'s LAN path loses its link while the run goes on, then gets it back.
async fn drop_while_running(
    mac: &mut Mac,
    dropped: &Machine,
    session: &SessionRef,
    other: &mut Watched,
) {
    mac.lan.as_ref().expect("a lan path").cut();
    status_until(dropped, "the link to drop", |status| !connected(status)).await;
    mac.bridge.release(session).await;
    other
        .until("the work and the ask, on the other phone", asked)
        .await;
    mac.lan.as_ref().expect("a lan path").release();
    status_until(dropped, "the link to come back", connected).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_link_dropped_mid_run_resumes_with_every_event_once() {
    let mut mac = Mac::on_lan().await;
    let (cut, steady) = (phone(), phone());
    let dropped = paired(&cut, &mac).await;
    let witness = pair_with(&steady, mac.direct_offer().await).await;
    let session = create_session(&dropped, &mac.root()).await;
    let mut chat = Watched::attach(&dropped, &session);
    let mut other = Watched::attach(&witness, &session);
    mac.bridge.script(&session, "hold_and_ask").await;
    prompt(&dropped, &session, PromptMode::Start, "Read the notes").await;
    chat.until("the run to hold", holding).await;

    drop_while_running(&mut mac, &dropped, &session, &mut other).await;
    chat.until("the work and the ask, after the drop", asked)
        .await;

    assert!(
        matches!(
            dropped.status().link.state,
            LinkState::Connected { resumed: true, .. }
        ),
        "the link session resumed"
    );
    assert_eq!(
        chat.replica.resets, 1,
        "the events came once, in order, with no reattach"
    );
    chat.assert_equal("mid-run, after the drop");
    assert!(
        chat.replica.snapshot == other.replica.snapshot,
        "both phones hold the same run"
    );
    assert!(
        run_texts(&chat.replica).len() > 20,
        "the run streamed while the link was down"
    );

    let interaction = chat.replica.snapshot.interactions[0].id.clone();
    dropped
        .request(choose(&session, interaction))
        .await
        .expect("answered");
    chat.until("the run to finish", finished).await;
    other.until("the run to finish", finished).await;
    chat.assert_equal("after the run");
    assert!(chat.replica.snapshot == other.replica.snapshot);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_bridge_restart_brings_the_view_back_from_a_fresh_snapshot() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    mac.bridge.script(&session, "hold").await;
    prompt(&machine, &session, PromptMode::Start, "Work on it").await;
    chat.until("the run to hold", holding).await;

    mac.bridge.restart().await;
    chat.until("the restarted bridge's snapshot", |replica| {
        replica.resets == 2
    })
    .await;
    assert!(
        chat.replica.snapshot.run.is_none(),
        "a run ends with its bridge"
    );
    chat.assert_equal("after the restart");
    status_until(&machine, "the new bridge to agree", ready).await;

    let outcome_before = chat.replica.snapshot.last_outcome.clone();
    prompt(&machine, &session, PromptMode::Start, "Once more").await;
    chat.until("the next run to finish", |replica| {
        finished(replica) && replica.snapshot.last_outcome != outcome_before
    })
    .await;
    chat.assert_equal("after a run on the new bridge");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_machine_that_starts_over_resets_the_link_and_views_resume_from_the_bridge() {
    let relay = TestRelay::start().await;
    let mut mac = Mac::on_relay(&relay).await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    mac.bridge.script(&session, "hold").await;
    prompt(&machine, &session, PromptMode::Start, "Work on it").await;
    chat.until("the run to hold", holding).await;

    mac.stop_daemon().await;
    status_until(&machine, "the link to drop", |status| !connected(status)).await;
    let asking = std::sync::Arc::clone(&machine);
    let in_flight = tokio::spawn(async move {
        let request = ClientMessage::BackendsList(BackendsListRequest {
            request_id: String::new(),
        });
        asking.request(request).await
    });
    mac.start_daemon().await;
    status_until(&machine, "a new link session and bridge socket", |status| {
        connected(status) && ready(status)
    })
    .await;
    assert!(
        matches!(
            in_flight.await.expect("the request's task"),
            Ok(ServerMessage::BackendsListResult(_))
        ),
        "a read the reset caught is sent again on the new link session and answered"
    );

    chat.until("the view, live again with the run on", |replica| {
        replica.live && holding(replica)
    })
    .await;
    mac.bridge.release(&session).await;
    chat.until("the run to finish", finished).await;
    assert_eq!(
        chat.replica.resets, 1,
        "the reattach resumed the same stream"
    );
    chat.assert_equal("after the run");
    relay.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_prompt_the_reset_caught_is_sent_again_and_runs_once() {
    let relay = TestRelay::start().await;
    let mut mac = Mac::on_relay(&relay).await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    chat.until("the view", |replica| replica.resets == 1).await;

    mac.stop_daemon().await;
    status_until(&machine, "the link to drop", |status| !connected(status)).await;
    let (asking, target) = (std::sync::Arc::clone(&machine), session.clone());
    let in_flight = tokio::spawn(async move {
        prompt(
            &asking,
            &target,
            PromptMode::Start,
            "Sent as the Mac restarted",
        )
        .await
    });
    mac.start_daemon().await;

    let result = in_flight.await.expect("the prompt's task");
    assert!(matches!(result, PromptResult::Accepted(_)), "{result:?}");
    chat.until("the run to finish", finished).await;
    let request = ClientMessage::TranscriptRead(TranscriptReadRequest {
        request_id: String::new(),
        session: session.clone(),
        page: PageRequest {
            cursor: None,
            limit: 200,
        },
    });
    let items = match machine.request(request).await.expect("the transcript") {
        ServerMessage::TranscriptReadResult(answer) => match answer.result {
            TranscriptReadResult::Accepted(read) => read.page.items,
            TranscriptReadResult::Rejected(rejected) => panic!("{rejected:?}"),
        },
        other => panic!("{other:?}"),
    };
    let sent = items
        .iter()
        .filter(|item| {
            matches!(item, TranscriptItem::UserMessage(message) if message.text == "Sent as the Mac restarted")
        })
        .count();
    assert_eq!(sent, 1, "the prompt ran exactly once");
    relay.stop().await;
}
