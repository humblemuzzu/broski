mod common;

use std::path::Path;
use std::time::Duration;

use broski_link_daemon::{run, Handle, RunOptions};
use mdns_sd::{Receiver, ResolvedService, ServiceDaemon, ServiceEvent};

const SERVICE: &str = "_broski-link._tcp.local.";
const WAIT: Duration = Duration::from_secs(10);

/// The machine answers a browse for `_broski-link._tcp` with its id, its protocol version and the
/// port the LAN listener really bound, under a name that carries the start of its id; stopping it
/// sends goodbyes that take the service off the network at once. Skipped where multicast is not
/// available.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_browser_sees_the_machine_and_sees_it_leave() {
    let dir = tempfile::tempdir().expect("temp home");
    let Some((browser, events)) = browse() else {
        return;
    };
    let daemon = start(&dir.path().join("link")).await;
    let port = daemon.lan_port.expect("a lan port");

    let Some(info) = resolved(&events, |info| info.get_port() == port).await else {
        eprintln!("skipping: the machine was not browsable here");
        finish(browser, daemon).await;
        return;
    };
    let id = info.get_property_val_str("id").expect("the machine id");
    assert_eq!(info.get_property_val_str("v"), Some("1"));
    assert!(
        info.get_fullname()
            .ends_with(&format!(" ({}).{SERVICE}", &id[..8])),
        "the instance names this machine: {}",
        info.get_fullname()
    );

    let fullname = info.get_fullname().to_owned();
    daemon.stop().await;
    assert!(
        removed(&events, &fullname).await,
        "a stopped machine's goodbye never reached the browser"
    );
    let _ = browser.shutdown();
}

/// A daemon restarted on the same home and a new port keeps its name and is seen on the new port:
/// it never renames itself away from the records its previous run left behind.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_restarted_machine_keeps_its_name_and_shows_its_new_port() {
    let dir = tempfile::tempdir().expect("temp home");
    let home = dir.path().join("link");
    let Some((browser, events)) = browse() else {
        return;
    };
    let first = start(&home).await;
    let first_port = first.lan_port.expect("a lan port");
    let Some(before) = resolved(&events, |info| info.get_port() == first_port).await else {
        eprintln!("skipping: the machine was not browsable here");
        finish(browser, first).await;
        return;
    };
    let id = before
        .get_property_val_str("id")
        .expect("the machine id")
        .to_owned();
    first.stop().await;

    let second = start(&home).await;
    let second_port = second.lan_port.expect("a lan port");
    let after = resolved(&events, |info| {
        info.get_property_val_str("id") == Some(id.as_str()) && info.get_port() == second_port
    })
    .await
    .expect("the restarted machine was never seen on its new port");
    assert_eq!(
        after.get_fullname(),
        before.get_fullname(),
        "the restart renamed the machine"
    );
    finish(browser, second).await;
}

async fn start(home: &Path) -> Handle {
    common::init_logs();
    run(RunOptions {
        home: home.to_path_buf(),
        relay: None,
        lan_port: 0,
        lan: true,
        bridge_socket: home.join("bridge.sock"),
        bridge_cmd: None,
        advertise: true,
        scan_interfaces: false,
        screen_port: 5900,
        watch_dialogs: false,
        durations: broski_link_daemon::durations::Durations::default(),
    })
    .await
    .expect("the daemon starts")
}

fn browse() -> Option<(ServiceDaemon, Receiver<ServiceEvent>)> {
    let browser = match ServiceDaemon::new() {
        Ok(browser) => browser,
        Err(error) => {
            eprintln!("skipping: no mdns responder here ({error})");
            return None;
        }
    };
    let events = browser.browse(SERVICE).expect("browse");
    Some((browser, events))
}

async fn resolved(
    events: &Receiver<ServiceEvent>,
    wanted: impl Fn(&ResolvedService) -> bool,
) -> Option<Box<ResolvedService>> {
    tokio::time::timeout(WAIT, async {
        while let Ok(event) = events.recv_async().await {
            if let ServiceEvent::ServiceResolved(info) = event {
                if wanted(&info) {
                    return Some(info);
                }
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

async fn removed(events: &Receiver<ServiceEvent>, fullname: &str) -> bool {
    tokio::time::timeout(WAIT, async {
        while let Ok(event) = events.recv_async().await {
            if let ServiceEvent::ServiceRemoved(_, name) = event {
                if name.eq_ignore_ascii_case(fullname) {
                    return true;
                }
            }
        }
        false
    })
    .await
    .unwrap_or(false)
}

async fn finish(browser: ServiceDaemon, daemon: Handle) {
    let _ = browser.shutdown();
    daemon.stop().await;
}
