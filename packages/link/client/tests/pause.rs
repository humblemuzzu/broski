//! Leaving the app: what the phone already sent reaches the Mac before the link pauses, and the
//! app learns when it may give up its background time.

mod common;

use std::time::Duration;

use broski_client::{LinkState, MachineStatus, WaitReason};
use broski_contract::{
    ClientMessage, PromptInput, PromptMode, PromptRequest, PromptResult, ServerMessage,
};
use broski_link_testkit::WAIT;
use common::replica::Replica;
use common::{
    client_request_id, create_session, pair_with, paired, phone, run_texts, status_until, Mac,
    Watched,
};
use tokio::time::{timeout, Instant};

fn paused(status: &MachineStatus) -> bool {
    status.link.state == LinkState::Waiting(WaitReason::Paused)
}

fn holding(replica: &Replica) -> bool {
    run_texts(replica) == ["Working."]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_prompt_sent_as_the_app_leaves_reaches_the_mac_before_the_link_pauses() {
    let mut mac = Mac::on_lan().await;
    let (leaving, staying) = (phone(), phone());
    let machine = paired(&leaving, &mac).await;
    let witness = pair_with(&staying, mac.direct_offer().await).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    chat.until("the view", |replica| replica.resets == 1).await;
    let mut other = Watched::attach(&witness, &session);
    mac.bridge.script(&session, "hold").await;

    let request = ClientMessage::Prompt(PromptRequest {
        request_id: String::new(),
        session: session.clone(),
        input: PromptInput {
            client_request_id: client_request_id(),
            mode: PromptMode::Start,
            text: "Sent as the app left".to_owned(),
            attachments: Vec::new(),
            command: None,
        },
    });
    let mut answer = Box::pin(machine.request(request));
    tokio::select! {
        biased;
        _ = &mut answer => panic!("answered before it could have been sent"),
        () = std::future::ready(()) => {}
    }
    leaving.pause();
    timeout(WAIT, leaving.paused())
        .await
        .expect("the pause settled");

    assert!(paused(&machine.status()), "{:?}", machine.status());
    other
        .until("the run, seen by the phone that stayed", holding)
        .await;

    leaving.resume();
    let result = match timeout(WAIT, answer).await.expect("the answer") {
        Ok(ServerMessage::PromptResult(answer)) => answer.result,
        other => panic!("{other:?}"),
    };
    assert!(matches!(result, PromptResult::Accepted(_)), "{result:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn paused_resolves_once_the_link_has_paused_and_at_once_after_a_resume() {
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;

    phone.pause();
    let started = Instant::now();
    timeout(WAIT, phone.paused())
        .await
        .expect("the pause settled");
    assert!(paused(&machine.status()), "{:?}", machine.status());
    assert!(started.elapsed() < Duration::from_secs(2));

    phone.resume();
    let started = Instant::now();
    phone.paused().await;
    assert!(
        started.elapsed() < Duration::from_millis(100),
        "nothing to wait for after a resume"
    );
    status_until(&machine, "the link to come back", |status| {
        matches!(status.link.state, LinkState::Connected { .. })
    })
    .await;
}
