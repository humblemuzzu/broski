//! A machine for the phone apps' own tests: the real daemon and the real bridge of `Mac::on_lan`,
//! serving until stdin closes. It prints `{"offer":"broski://pair?…","root":"<served dir>"}` once
//! the bridge is up, then answers one JSON command per stdin line with one line:
//!
//! - `{"seed":"<title>"}` → `{"seeded":<session>}`: a session with one finished exchange in the root
//! - `{"script":<session>,"scenario":"<name>"}` → `{"scripted":<session>}`: the session's next run
//!   (names in `packages/bridge/scripts/dev-fake-bridge/scenarios.ts`)
//! - `{"release":<session>}` → `{"released":<session>}`: ends the hold the run waits in
//! - `{"restart":true}` → `{"restarted":true}`: the bridge restarts in place, every run ended
//!
//! A `<session>` is `{"backend":…,"sessionId":…}`; anything else is answered `{"error":"…"}`.

use broski_contract::SessionRef;
use broski_link_testkit::mac::Mac;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut mac = Mac::on_lan().await;
    println!(
        "{}",
        json!({"offer": mac.offer().await, "root": mac.root_text()})
    );
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(command) => run(&mut mac, &command).await,
            Err(_) => None,
        };
        let answer =
            answer.unwrap_or_else(|| json!({ "error": format!("unknown command: {line}") }));
        println!("{answer}");
    }
}

async fn run(mac: &mut Mac, command: &Value) -> Option<Value> {
    if let Some(title) = command["seed"].as_str() {
        let root = mac.root();
        let session = mac.bridge.seed(&root, title).await;
        return Some(json!({ "seeded": session }));
    }
    if let (Some(session), Some(scenario)) =
        (session(&command["script"]), command["scenario"].as_str())
    {
        mac.bridge.script(&session, scenario).await;
        return Some(json!({ "scripted": session }));
    }
    if let Some(session) = session(&command["release"]) {
        mac.bridge.release(&session).await;
        return Some(json!({ "released": session }));
    }
    if command["restart"] == json!(true) {
        mac.bridge.restart().await;
        return Some(json!({ "restarted": true }));
    }
    None
}

fn session(value: &Value) -> Option<SessionRef> {
    serde_json::from_value(value.clone()).ok()
}
