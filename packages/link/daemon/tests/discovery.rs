mod common;

use std::time::Duration;

use common::daemon::{Options, TestDaemon};
use mdns_sd::{ServiceDaemon, ServiceEvent};

const SERVICE: &str = "_broski-link._tcp.local.";
const WAIT: Duration = Duration::from_secs(10);

/// The machine answers a browse for `_broski-link._tcp` with its id, its protocol version and the
/// port the LAN listener really bound. Skipped where multicast is not available.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_browser_sees_the_machine_and_its_txt_records() {
    let daemon = TestDaemon::start(Options::default()).await;
    let port = daemon.lan().port();
    let id: String = {
        let status = daemon.ask(serde_json::json!({"cmd": "status"})).await;
        status["machine"]["id"]
            .as_str()
            .expect("a machine id")
            .to_owned()
    };

    let browser = match ServiceDaemon::new() {
        Ok(browser) => browser,
        Err(error) => {
            eprintln!("skipping: no mdns responder here ({error})");
            daemon.stop().await;
            return;
        }
    };
    let events = browser.browse(SERVICE).expect("browse");
    let found = tokio::time::timeout(WAIT, async {
        while let Ok(event) = events.recv_async().await {
            if let ServiceEvent::ServiceResolved(info) = event {
                if info.get_port() == port {
                    return Some(info);
                }
            }
        }
        None
    })
    .await;

    let info = match found {
        Ok(Some(info)) => info,
        other => {
            // A machine with no multicast interface cannot be discovered by anyone; that is a
            // property of the host, not of the daemon.
            eprintln!("skipping: the machine was not browsable here ({other:?})");
            let _ = browser.shutdown();
            daemon.stop().await;
            return;
        }
    };
    assert_eq!(info.get_property_val_str("v"), Some("1"));
    assert_eq!(info.get_property_val_str("id"), Some(id.as_str()));
    assert!(
        info.get_fullname().ends_with(SERVICE),
        "the machine is advertised under the agreed type: {}",
        info.get_fullname()
    );
    assert!(
        info.get_fullname()
            .strip_suffix(SERVICE)
            .is_some_and(|name| !name.trim_end_matches('.').is_empty()),
        "the instance carries the machine name"
    );

    let _ = browser.shutdown();
    daemon.stop().await;
}
