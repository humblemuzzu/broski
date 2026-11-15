//! A machine's catalog against the real bridge: the backends, their lists, and session lists kept
//! current by the rows the catalog sends.

mod common;

use std::sync::Arc;

use broski_client::{SessionList, SessionListUpdate};
use broski_contract::{
    ActionResult, BackendId, ClientMessage, ModelsListResult, ModesListResult, ServerMessage,
    SessionDeleteRequest, SessionQuery, SessionRef, SessionRenameRequest,
};
use broski_link_testkit::WAIT;
use common::{create_session, paired, phone, Mac};
use tokio::time::{timeout_at, Instant};

async fn rows_until(
    list: &SessionList,
    what: &str,
    done: impl Fn(&SessionListUpdate) -> bool,
) -> SessionListUpdate {
    let deadline = Instant::now() + WAIT;
    let mut rows = list.rows();
    while !done(&rows) {
        rows = timeout_at(deadline, list.next_change())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {what}: {rows:?}"))
            .expect("the list goes on");
    }
    rows
}

fn has(rows: &SessionListUpdate, session: &SessionRef) -> bool {
    rows.rows.iter().any(|row| &row.session == session)
}

fn title_of(rows: &SessionListUpdate, session: &SessionRef) -> Option<String> {
    let row = rows.rows.iter().find(|row| &row.session == session)?;
    row.title.as_ref().map(|title| title.text.clone())
}

async fn act(machine: &broski_client::Machine, request: ClientMessage) {
    let accepted = match machine.request(request).await.expect("an answer") {
        ServerMessage::SessionRenameResult(answer) => answer.result,
        ServerMessage::SessionDeleteResult(answer) => answer.result,
        other => panic!("{other:?}"),
    };
    assert!(
        matches!(accepted, ActionResult::Accepted(_)),
        "{accepted:?}"
    );
}

fn list_in(machine: &Arc<broski_client::Machine>, cwd: &std::path::Path) -> Arc<SessionList> {
    let query = SessionQuery {
        cwd: Some(cwd.to_string_lossy().into_owned()),
        parent: None,
    };
    let list = Arc::clone(machine).session_list(BackendId::Pi, query);
    list.expect("a list")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn session_rows_follow_creates_renames_and_deletes() {
    let mut mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let elsewhere = mac.root().join("elsewhere");
    std::fs::create_dir(&elsewhere).expect("a second directory");
    let seeded = mac.bridge.seed(&mac.root(), "Seeded").await;

    let list = list_in(&machine, &mac.root());
    let other = list_in(&machine, &elsewhere);
    rows_until(&list, "the seeded session", |rows| has(rows, &seeded)).await;

    let created = create_session(&machine, &mac.root()).await;
    let rows = rows_until(&list, "the created session and the first page", |rows| {
        has(rows, &created) && !rows.has_more
    })
    .await;
    assert_eq!(rows.rows[0].session, created, "newest first");

    let rename = ClientMessage::SessionRename(SessionRenameRequest {
        request_id: String::new(),
        session: created.clone(),
        title: "Renamed".to_owned(),
    });
    act(&machine, rename).await;
    rows_until(&list, "the new title", |rows| {
        title_of(rows, &created).as_deref() == Some("Renamed")
    })
    .await;

    let delete = ClientMessage::SessionDelete(SessionDeleteRequest {
        request_id: String::new(),
        session: created.clone(),
    });
    act(&machine, delete).await;
    let rows = rows_until(&list, "the row to go", |rows| !has(rows, &created)).await;
    assert!(has(&rows, &seeded));
    assert!(
        other.rows().rows.is_empty(),
        "another directory's list took no row"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn backends_and_their_catalogs_are_read_and_kept() {
    let mac = Mac::on_lan().await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    let status = machine
        .backend_status(BackendId::Pi)
        .await
        .expect("a status");
    assert!(status.usable);
    let cwd = Some(mac.root_text());
    let models = machine
        .models(BackendId::Pi, cwd.clone(), false)
        .await
        .expect("models");
    let ModelsListResult::Accepted(listed) = &models else {
        panic!("{models:?}");
    };
    assert!(!listed.models.is_empty());
    assert_eq!(
        machine.models(BackendId::Pi, cwd.clone(), false).await,
        Ok(models)
    );
    let modes = machine
        .modes(BackendId::Pi, cwd.clone())
        .await
        .expect("modes");
    assert!(matches!(modes, ModesListResult::Accepted(ref listed) if !listed.modes.is_empty()));
    let commands = machine
        .commands(BackendId::Pi, cwd, None)
        .await
        .expect("commands");
    assert_eq!(
        machine
            .commands(BackendId::Pi, Some(mac.root_text()), None)
            .await,
        Ok(commands)
    );
}
