use std::time::Duration;

use broski_link_power::{
    AwakeAssertion, Error as PowerError, PowerEvent, PowerMonitor, PowerStatus,
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tracing::{debug, info, warn};

use crate::durations::Durations;
use crate::relay::RelayCommand;

const REASON: &str = "broski-link: agent working";
const BATTERY_FLOOR: u8 = 30;

/// Reports `WillSleep` to the relay and waits for the write to land, inside the monitor's grace.
pub struct SleepNotifier {
    relay: mpsc::Sender<RelayCommand>,
    handle: tokio::runtime::Handle,
    grace: Duration,
}

impl SleepNotifier {
    pub fn new(relay: mpsc::Sender<RelayCommand>, grace: Duration) -> SleepNotifier {
        SleepNotifier {
            relay,
            handle: tokio::runtime::Handle::current(),
            grace,
        }
    }

    pub fn notify(&self) {
        let (done, written) = oneshot::channel();
        if self
            .relay
            .blocking_send(RelayCommand::Sleep { done })
            .is_err()
        {
            return;
        }
        let _ = self
            .handle
            .block_on(async { tokio::time::timeout(self.grace, written).await });
    }
}

pub struct Deps {
    pub busy: watch::Receiver<bool>,
    pub relay: mpsc::Sender<RelayCommand>,
    pub durations: Durations,
}

pub fn spawn(deps: Deps, mut shutdown: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let monitor = monitor(SleepNotifier::new(
            deps.relay.clone(),
            deps.durations.sleep_grace,
        ));
        keep_awake(deps, &mut shutdown).await;
        if let Some(monitor) = monitor {
            let _ = tokio::task::spawn_blocking(move || drop(monitor)).await;
        }
    })
}

fn monitor(notifier: SleepNotifier) -> Option<PowerMonitor> {
    let grace = notifier.grace;
    match PowerMonitor::start(grace, move |event| {
        if event == PowerEvent::WillSleep {
            notifier.notify();
        }
    }) {
        Ok(monitor) => Some(monitor),
        Err(PowerError::Unsupported) => {
            info!("power management is unavailable: sleep is not reported and the machine is never held awake");
            None
        }
        Err(error) => {
            warn!(error = %error, "power monitor did not start");
            None
        }
    }
}

struct Hold {
    _assertion: AwakeAssertion,
    since: Instant,
}

#[derive(Default)]
struct Keep {
    hold: Option<Hold>,
    locked: bool,
    unsupported: bool,
}

impl Keep {
    fn release(&mut self) {
        self.hold = None;
    }
}

async fn keep_awake(deps: Deps, shutdown: &mut watch::Receiver<bool>) {
    let mut busy = deps.busy.clone();
    let mut is_busy = *busy.borrow_and_update();
    let mut keep = Keep::default();
    if is_busy {
        evaluate(&mut keep);
    }
    let mut tick = Instant::now() + deps.durations.keep_awake_check;
    loop {
        tokio::select! {
            changed = busy.changed() => {
                if changed.is_err() {
                    return;
                }
                is_busy = *busy.borrow_and_update();
                if is_busy {
                    keep.locked = false;
                    evaluate(&mut keep);
                } else {
                    keep.release();
                }
                tick = Instant::now() + deps.durations.keep_awake_check;
            }
            _ = tokio::time::sleep_until(tick), if is_busy => {
                if keep
                    .hold
                    .as_ref()
                    .is_some_and(|hold| hold.since.elapsed() >= deps.durations.keep_awake_max)
                {
                    keep.release();
                    keep.locked = true;
                    info!("held awake for the whole window; releasing until the next turn");
                }
                evaluate(&mut keep);
                tick = Instant::now() + deps.durations.keep_awake_check;
            }
            _ = shutdown.wait_for(|stopped| *stopped) => return,
        }
    }
}

fn evaluate(keep: &mut Keep) {
    if keep.unsupported {
        return;
    }
    if keep.locked || !wants(&broski_link_power::power_status()) {
        keep.release();
        return;
    }
    if keep.hold.is_some() {
        return;
    }
    match AwakeAssertion::acquire(REASON) {
        Ok(assertion) => {
            keep.hold = Some(Hold {
                _assertion: assertion,
                since: Instant::now(),
            });
        }
        Err(PowerError::Unsupported) => {
            keep.unsupported = true;
            info!("power management is unsupported: the machine is not held awake while an agent works");
        }
        Err(error) => debug!(error = %error, "idle-sleep assertion refused"),
    }
}

fn wants(status: &PowerStatus) -> bool {
    status.on_ac == Some(true)
        || status
            .battery_percent
            .is_some_and(|percent| percent >= BATTERY_FLOOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_sleep_notice_waits_for_the_relay_write() {
        let (relay, mut inbox) = mpsc::channel(4);
        let receiving = tokio::spawn(async move {
            match inbox.recv().await {
                Some(RelayCommand::Sleep { done }) => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    done.send(()).is_ok()
                }
                _ => false,
            }
        });
        let notifier = SleepNotifier::new(relay, Duration::from_secs(2));
        let started = std::time::Instant::now();
        tokio::task::spawn_blocking(move || notifier.notify())
            .await
            .expect("the notifier thread runs");
        assert!(
            started.elapsed() >= Duration::from_millis(100),
            "notify returns only once the relay acknowledged the write"
        );
        assert!(receiving.await.expect("the relay task runs"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_relay_that_never_answers_holds_the_notice_for_the_grace_only() {
        let (relay, inbox) = mpsc::channel(4);
        let grace = Duration::from_millis(100);
        let notifier = SleepNotifier::new(relay, grace);
        let started = std::time::Instant::now();
        tokio::task::spawn_blocking(move || notifier.notify())
            .await
            .expect("the notifier thread runs");
        let waited = started.elapsed();
        assert!(
            waited >= grace && waited < Duration::from_secs(2),
            "the notice is bounded by the sleep grace, not by the relay"
        );
        drop(inbox);
    }
}
