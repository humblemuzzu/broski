//! Answering from the inbox over the real bridge: a session a terminal started waits on a tool
//! permission, and its row knows the ask and its options without the app opening a chat; the
//! person's tap answers it; the inbox views at most eight waiting sessions per machine, newest
//! first, and lets each view go once its row stops waiting.

mod common;

use std::sync::Arc;

use broski_client::{AnswerOutcome, InboxRow, InboxState, Machine, Phone};
use broski_contract::{InteractionKind, PermissionEffect, PermissionScope, SessionRef};
use common::{inbox_until, paired, phone, Mac};

fn row<'a>(rows: &'a [InboxRow], session: &SessionRef) -> Option<&'a InboxRow> {
    rows.iter().find(|row| &row.session == session)
}

fn asked(session: &SessionRef) -> impl Fn(&[InboxRow]) -> bool {
    let session = session.clone();
    move |rows| row(rows, &session).is_some_and(|row| row.pending.is_some())
}

/// Allows the session's pending ask from its row, as the person's tap does.
async fn allow(phone: &Phone, machine: &Machine, row: &InboxRow) -> AnswerOutcome {
    let pending = row.pending.as_ref().expect("a pending ask");
    let allow = pending.allow.as_ref().expect("an allow option");
    let inbox = phone.inbox();
    let answer = inbox.answer(
        machine.id(),
        row.session.clone(),
        pending.interaction_id.clone(),
        allow.id.clone(),
    );
    answer.await.expect("an answer")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_permission_is_answered_from_its_row_once() {
    let mut mac = Mac::on_lan().await;
    let session = mac.bridge.seed(&mac.root(), "Clean up").await;
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    inbox_until(&phone, "the seeded row", |rows| {
        row(rows, &session).is_some()
    })
    .await;

    mac.bridge.run(&session, "permission").await;
    let rows = inbox_until(&phone, "the row's pending ask", asked(&session)).await;
    let waiting = row(&rows, &session).expect("the row");
    assert_eq!(waiting.state, InboxState::NeedsYou);
    assert_eq!(waiting.ask.as_deref(), Some("Run bash?"));
    assert_eq!(
        waiting.command.as_deref(),
        Some("rm -rf build"),
        "the fake previews the command it was given"
    );
    assert!(!waiting.cached);
    let pending = waiting.pending.as_ref().expect("pending");
    assert_eq!(pending.kind, InteractionKind::ToolPermission);
    let allow = pending.allow.as_ref().expect("allow");
    assert_eq!(
        (allow.id.as_str(), allow.effect, allow.scope),
        ("allow_once", PermissionEffect::Allow, PermissionScope::Once)
    );
    let deny = pending.deny.as_ref().expect("deny");
    assert_eq!(
        (deny.effect, deny.stops_run),
        (PermissionEffect::Deny, false)
    );

    let inbox = phone.inbox();
    let answer = |option: &str| {
        inbox.answer(
            machine.id(),
            session.clone(),
            pending.interaction_id.clone(),
            option.to_owned(),
        )
    };
    let unoffered = answer("allow_always").await;
    assert!(
        unoffered.is_err(),
        "only the row's own options: {unoffered:?}"
    );
    let (first, second) = tokio::join!(answer("allow_once"), answer("allow_once"));
    let mut outcomes = [first.expect("first"), second.expect("second")];
    outcomes.sort_by_key(|outcome| *outcome != AnswerOutcome::Accepted);
    assert_eq!(
        outcomes,
        [AnswerOutcome::Accepted, AnswerOutcome::Stale],
        "the bridge takes one answer"
    );

    let done = inbox_until(&phone, "the run to finish", |rows| {
        row(rows, &session).is_some_and(|row| row.state == InboxState::Done)
    })
    .await;
    assert!(row(&done, &session).expect("row").pending.is_none());
    let late = answer("allow_once").await.expect("an outcome");
    assert_eq!(late, AnswerOutcome::Stale, "Already answered elsewhere");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn eight_waiting_sessions_hold_views_until_they_stop_waiting() {
    let mut mac = Mac::on_lan().await;
    let mut waiting = Vec::new();
    for index in 0..10 {
        waiting.push(
            mac.bridge
                .seed(&mac.root(), &format!("Waiting {index}"))
                .await,
        );
    }
    let mut idle = Vec::new();
    for index in 0..32 {
        idle.push(mac.bridge.seed(&mac.root(), &format!("Idle {index}")).await);
    }
    let phone = phone();
    let machine = paired(&phone, &mac).await;
    inbox_until(&phone, "every row", |rows| rows.len() == 42).await;
    for session in &waiting {
        mac.bridge.run(session, "permission").await;
    }
    let rows = inbox_until(&phone, "ten waiting, eight with their ask", |rows| {
        let needs_you = rows.iter().filter(|row| row.state == InboxState::NeedsYou);
        let held = rows.iter().filter(|row| row.pending.is_some()).count();
        needs_you.count() == 10 && held == 8
    })
    .await;
    let mut by_age: Vec<&InboxRow> = rows
        .iter()
        .filter(|row| row.state == InboxState::NeedsYou)
        .collect();
    by_age.sort_by_key(|row| row.updated_at);
    assert!(
        by_age[..2].iter().all(|row| row.pending.is_none()),
        "the two oldest wait without a view"
    );

    let views: Vec<_> = idle[..24]
        .iter()
        .map(|session| {
            Arc::clone(&machine)
                .attach(session.clone())
                .expect("a view")
        })
        .collect();
    let refused = Arc::clone(&machine).attach(idle[24].clone());
    assert!(refused.is_err(), "the inbox holds 8 of the 32 views");
    drop(views);

    for _ in 0..10 {
        let rows = inbox_until(&phone, "a held ask", |rows| {
            rows.iter().any(|row| row.pending.is_some())
        })
        .await;
        let held = rows.iter().find(|row| row.pending.is_some()).expect("held");
        assert_eq!(allow(&phone, &machine, held).await, AnswerOutcome::Accepted);
        let session = held.session.clone();
        inbox_until(&phone, "the answered row to move on", move |rows| {
            row(rows, &session).is_some_and(|row| row.pending.is_none())
        })
        .await;
    }
    inbox_until(&phone, "nothing waiting", |rows| {
        rows.iter().all(|row| row.state != InboxState::NeedsYou)
    })
    .await;
    let views: Vec<_> = idle
        .iter()
        .map(|session| Arc::clone(&machine).attach(session.clone()))
        .collect();
    assert!(
        views.iter().all(Result::is_ok),
        "every inbox view was let go, so the app has all 32"
    );
}
