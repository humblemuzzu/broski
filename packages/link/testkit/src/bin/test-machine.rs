//! A machine for the phone apps' own tests (`apps/ios/BroskiCore`): the real daemon and the real
//! bridge of `Mac::on_lan`, serving until stdin closes. It prints one JSON line,
//! `{"offer":"broski://pair?…","root":"<the directory the bridge serves>"}`, once the bridge is up.

use broski_link_testkit::mac::Mac;
use serde_json::json;
use tokio::io::AsyncReadExt;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mac = Mac::on_lan().await;
    println!(
        "{}",
        json!({"offer": mac.offer().await, "root": mac.root_text()})
    );
    let mut rest = Vec::new();
    let _ = tokio::io::stdin().read_to_end(&mut rest).await;
}
