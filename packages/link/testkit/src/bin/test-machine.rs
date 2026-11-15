//! A machine for the phone apps' own tests (`apps/ios`): the real daemon and the real bridge of
//! `Mac::on_lan`, serving until stdin closes. It prints one JSON line,
//! `{"offer":"broski://pair?…","root":"<the directory the bridge serves>"}`, once the bridge is up.
//!
//! Each stdin line `{"seed":"<title>"}` adds a session with one finished exchange in the root, as
//! the fake backend's `seed` does, and is answered `{"seeded":{"backend":…,"sessionId":…}}`.

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
    let root = mac.root();
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let command: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        match command["seed"].as_str() {
            Some(title) => {
                let session = mac.bridge.seed(&root, title).await;
                println!("{}", json!({ "seeded": session }));
            }
            None => println!("{}", json!({ "error": format!("unknown command: {line}") })),
        }
    }
}
