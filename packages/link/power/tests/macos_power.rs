#![cfg(target_os = "macos")]

use std::process::Command;
use std::thread;
use std::time::Duration;

use broski_link_power::{power_status, AwakeAssertion, PowerMonitor, PowerStatus};

const REASON: &str = "broski-link-power test assertion";

fn assertions() -> String {
    let output = Command::new("pmset")
        .args(["-g", "assertions"])
        .output()
        .expect("pmset should run");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn assertion_is_listed() -> bool {
    assertions()
        .lines()
        .any(|line| line.contains(REASON) && line.contains("PreventUserIdleSystemSleep"))
}

#[test]
fn awake_assertion_is_held_then_released() {
    let assertion = AwakeAssertion::acquire(REASON).expect("acquire");
    assert!(
        assertion_is_listed(),
        "pmset does not list it:\n{}",
        assertions()
    );

    drop(assertion);

    for _ in 0..20 {
        if !assertions().contains(REASON) {
            return;
        }
        thread::sleep(Duration::from_millis(250));
    }
    panic!("pmset still lists it:\n{}", assertions());
}

#[test]
fn power_status_reports_the_ac_line() {
    let PowerStatus { on_ac, .. } = power_status();
    assert!(
        on_ac.is_some(),
        "a MacBook on a power source should report one"
    );
}

#[test]
#[ignore = "manual: needs a real sleep/wake cycle"]
fn manual_sleep_watch() {
    let started = std::time::Instant::now();
    let monitor = PowerMonitor::start(Duration::from_secs(5), move |event| {
        println!("t+{:.1}s {event:?}", started.elapsed().as_secs_f64());
    })
    .expect("start");

    for _ in 0..120 {
        thread::sleep(Duration::from_secs(1));
    }
    drop(monitor);
}
