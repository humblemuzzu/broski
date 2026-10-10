#![cfg(target_os = "macos")]

mod common;

use std::time::Duration;

use broski_link_power::{power_status, PowerStatus};
use common::daemon::{Options, TestDaemon};
use common::feed::FakeFeed;
use common::scenario::{quick_durations, WAIT};
use serde_json::json;
use tokio::process::Command;

const REASON: &str = "broski-link: agent working";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_working_agent_holds_an_idle_sleep_assertion() {
    let status = power_status();
    if !would_hold(&status) {
        println!("skipped: no AC and no battery above 30% ({status:?})");
        return;
    }
    let daemon = TestDaemon::start(Options {
        lan: false,
        durations: quick_durations(),
        ..Options::default()
    })
    .await;
    let feed = FakeFeed::start(daemon.bridge_socket.clone()).await;
    feed.await_feed(WAIT).await;

    feed.send(json!({"type": "link_busy", "busy": true}));
    assert!(
        await_assertion(true, WAIT).await,
        "a working agent is holding the machine awake:\n{}",
        assertions().await
    );
    feed.send(json!({"type": "link_busy", "busy": false}));
    assert!(
        await_assertion(false, WAIT).await,
        "the assertion outlived the work"
    );
    assert_eq!(
        feed.roles("link-daemon"),
        1,
        "the feed is one socket even with no relay and no letters to carry"
    );

    daemon.stop().await;
    feed.stop().await;
}

fn would_hold(status: &PowerStatus) -> bool {
    status.on_ac == Some(true) || status.battery_percent.is_some_and(|percent| percent >= 30)
}

async fn await_assertion(expected: bool, budget: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        if listed(&assertions().await) == expected {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// `pmset` names the assertion type and the reason on one line.
fn listed(text: &str) -> bool {
    text.lines()
        .any(|line| line.contains(REASON) && line.contains("PreventUserIdleSystemSleep"))
}

async fn assertions() -> String {
    let output = Command::new("pmset")
        .arg("-g")
        .arg("assertions")
        .output()
        .await
        .expect("pmset -g assertions runs");
    String::from_utf8_lossy(&output.stdout).into_owned()
}
