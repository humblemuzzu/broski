//! A view, and the inbox, come back by themselves when the bridge refuses for a while: an attach the
//! backend could not serve, a bridge whose backend is not up yet, list pages that fail. Nothing waits
//! for the person to try again.

mod common;

use broski_client::{SessionUpdate, ViewEnd};
use broski_contract::PromptMode;
use common::replica::Replica;
use common::{
    create_session, inbox_until, paired, phone, prompt, ready, run_texts, status_until, Mac,
    Watched,
};

fn holding(replica: &Replica) -> bool {
    run_texts(replica) == ["Working."]
}

fn finished(replica: &Replica) -> bool {
    replica.snapshot.run.is_none() && replica.snapshot.last_outcome.is_some()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_attach_refused_for_a_while_is_tried_again_until_it_is_served() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = mac.bridge.seed(&mac.root(), "Opened late").await;
    mac.bridge.fail_opens(2).await;

    let mut chat = Watched::attach(&machine, &session);
    let first = chat.next().await;
    assert!(
        matches!(first, SessionUpdate::Reset { .. }),
        "after two refusals the view attaches: {first:?}"
    );
    assert!(chat.replica.live);
    chat.assert_equal("once attached");

    mac.bridge.script(&session, "work").await;
    prompt(&machine, &session, PromptMode::Start, "Go on").await;
    chat.until("the run to finish", finished).await;
    chat.assert_equal("after the run");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_view_outlives_a_bridge_that_came_back_without_its_backend() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let session = create_session(&machine, &mac.root()).await;
    let mut chat = Watched::attach(&machine, &session);
    mac.bridge.script(&session, "hold").await;
    prompt(&machine, &session, PromptMode::Start, "Work on it").await;
    chat.until("the run to hold", holding).await;

    mac.bridge.restart_with_backend_down().await;
    chat.until("the view to say it is not live", |replica| !replica.live)
        .await;
    status_until(&machine, "the restarted bridge to agree", ready).await;
    assert!(holding(&chat.replica), "the last state stays on screen");
    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    assert_eq!(
        chat.view.snapshot().map(|snapshot| snapshot.run.is_some()),
        Some(true),
        "refused as unknown_backend meanwhile, the view keeps what it knew"
    );

    mac.bridge.restart().await;
    chat.until("the view, live again from a fresh snapshot", |replica| {
        replica.live && replica.resets == 2
    })
    .await;
    assert_eq!(chat.replica.ended, None);
    assert!(
        chat.replica.snapshot.run.is_none(),
        "a run ends with its bridge"
    );
    chat.assert_equal("after the backend came up");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_inbox_loads_by_itself_after_its_pages_failed() {
    let mut mac = Mac::on_lan().await;
    let session = mac.bridge.seed(&mac.root(), "Listed late").await;
    mac.bridge.fail_lists(2).await;
    let phone = phone();
    let _machine = paired(&phone, &mac).await;

    let rows = inbox_until(&phone, "the session listed", |rows| {
        rows.iter().any(|row| row.session == session)
    })
    .await;
    let row = rows.iter().find(|row| row.session == session).expect("row");
    assert!(!row.cached, "the machine's own row");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_attach_refused_for_good_ends_the_view_refused() {
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let gone = broski_contract::SessionRef {
        backend: broski_contract::BackendId::Pi,
        session_id: "never-was".to_owned(),
    };
    let view = std::sync::Arc::clone(&machine)
        .attach(gone)
        .expect("a view");
    let update = tokio::time::timeout(broski_link_testkit::WAIT, view.next_update())
        .await
        .expect("an update in time");
    assert!(
        matches!(
            update,
            Some(SessionUpdate::Ended {
                reason: ViewEnd::Refused { .. }
            })
        ),
        "a session the bridge does not know ends the view after a few tries: {update:?}"
    );
}
