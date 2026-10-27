use std::fs;
use std::path::Path;
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tracing::warn;
use zbus::blocking::proxy::SignalIterator;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedFd;

use crate::event_worker::{self, Notification};
use crate::{Error, EventHandler, PowerEvent, PowerStatus};

const LOGIN1_DESTINATION: &str = "org.freedesktop.login1";
const LOGIN1_PATH: &str = "/org/freedesktop/login1";
const LOGIN1_INTERFACE: &str = "org.freedesktop.login1.Manager";
const SLEEP_SIGNAL: &str = "PrepareForSleep";
const WHO: &str = "broski-link";
const WHY_SLEEP: &str = "report sleep";
const WHAT_SLEEP: &str = "sleep";
const WHAT_IDLE: &str = "idle";
const DELAY: &str = "delay";
const BLOCK: &str = "block";
const POWER_SUPPLY_DIR: &str = "/sys/class/power_supply";
/// How long a stop waits for the signal thread to end before leaving it behind. The thread blocks
/// on a D-Bus signal, so closing the connection is what should end it; this is the bound that makes
/// that a promise rather than a hope.
const MONITOR_JOIN: Duration = Duration::from_secs(2);

pub(crate) struct MonitorInner {
    connection: Option<Connection>,
    notify: Option<mpsc::Sender<Notification>>,
    monitor: Option<JoinHandle<()>>,
    finished: Option<mpsc::Receiver<()>>,
    worker: Option<JoinHandle<()>>,
}

/// Signals the waiting `stop` on the way out of the monitor thread, a panic included.
struct Finished(mpsc::SyncSender<()>);

impl Drop for Finished {
    fn drop(&mut self) {
        let _ = self.0.try_send(());
    }
}

pub(crate) fn start(grace: Duration, on_event: EventHandler) -> Result<MonitorInner, Error> {
    let connection = Connection::system().map_err(|_| Error::Unsupported)?;
    let manager = manager_proxy(&connection)?;
    let delay_lock = inhibit(&manager, WHAT_SLEEP, WHY_SLEEP, DELAY).ok_or(Error::Unsupported)?;
    let signals = manager
        .receive_signal(SLEEP_SIGNAL)
        .map_err(|err| Error::Os(format!("cannot watch {SLEEP_SIGNAL}: {err}")))?;

    let (notify, worker) = event_worker::spawn(on_event)
        .map_err(|err| Error::Os(format!("cannot spawn the power event thread: {err}")))?;

    let (finished, done) = mpsc::sync_channel::<()>(1);
    let monitor = thread::Builder::new()
        .name("broski-power-monitor".to_owned())
        .spawn({
            let notify = notify.clone();
            move || {
                let _finished = Finished(finished);
                watch(manager, signals, delay_lock, grace, notify)
            }
        })
        .map_err(|err| Error::Os(format!("cannot spawn the power monitor thread: {err}")))?;

    Ok(MonitorInner {
        connection: Some(connection),
        notify: Some(notify),
        monitor: Some(monitor),
        finished: Some(done),
        worker: Some(worker),
    })
}

pub(crate) fn stop(inner: &mut MonitorInner) {
    if let Some(connection) = inner.connection.take() {
        let _ = connection.close();
    }
    drop(inner.notify.take());
    let stopped = match inner.finished.take() {
        Some(done) => match done.recv_timeout(MONITOR_JOIN) {
            Ok(()) => true,
            Err(error) => {
                warn!(
                    error = %error,
                    window = ?MONITOR_JOIN,
                    "the power monitor did not stop in time; leaving its thread behind"
                );
                false
            }
        },
        None => true,
    };
    // The event thread only ends once nothing can report to it, which is the monitor thread's
    // sender: joining it after a monitor that would not stop would hang shutdown all the same.
    if !stopped {
        inner.monitor = None;
        inner.worker = None;
        return;
    }
    if let Some(monitor) = inner.monitor.take() {
        let _ = monitor.join();
    }
    if let Some(worker) = inner.worker.take() {
        let _ = worker.join();
    }
}

fn watch(
    manager: Proxy<'static>,
    signals: SignalIterator<'static>,
    delay_lock: OwnedFd,
    grace: Duration,
    notify: mpsc::Sender<Notification>,
) {
    let mut delay_lock = Some(delay_lock);
    for message in signals {
        let Ok(asleep) = message.body().deserialize::<bool>() else {
            continue;
        };
        if asleep {
            event_worker::report(&notify, PowerEvent::WillSleep, grace);
            // Closing the lock's file descriptor is what tells logind it may go on to sleep.
            drop(delay_lock.take());
        } else {
            event_worker::report(&notify, PowerEvent::DidWake, grace);
            delay_lock = inhibit(&manager, WHAT_SLEEP, WHY_SLEEP, DELAY);
        }
    }
}

fn manager_proxy(connection: &Connection) -> Result<Proxy<'static>, Error> {
    Proxy::new_owned(
        connection.clone(),
        LOGIN1_DESTINATION,
        LOGIN1_PATH,
        LOGIN1_INTERFACE,
    )
    .map_err(|_| Error::Unsupported)
}

fn inhibit(manager: &Proxy<'_>, what: &str, why: &str, mode: &str) -> Option<OwnedFd> {
    let reply = manager
        .call_method("Inhibit", &(what, WHO, why, mode))
        .ok()?;
    reply.body().deserialize::<OwnedFd>().ok()
}

pub struct AwakeAssertion {
    _connection: Connection,
    _lock: OwnedFd,
}

impl AwakeAssertion {
    pub fn acquire(reason: &str) -> Result<Self, Error> {
        let connection = Connection::system().map_err(|_| Error::Unsupported)?;
        let manager = manager_proxy(&connection)?;
        let lock = inhibit(&manager, WHAT_IDLE, reason, BLOCK).ok_or(Error::Unsupported)?;
        Ok(Self {
            _connection: connection,
            _lock: lock,
        })
    }
}

pub fn power_status() -> PowerStatus {
    let mut status = PowerStatus::default();
    let Ok(entries) = fs::read_dir(POWER_SUPPLY_DIR) else {
        return status;
    };
    for entry in entries.flatten() {
        let supply = entry.path();
        match read_trimmed(&supply.join("type")).as_deref() {
            Some("Mains") => {
                status.on_ac = read_trimmed(&supply.join("online")).map(|online| online == "1");
            }
            Some("Battery") => {
                status.battery_percent =
                    read_trimmed(&supply.join("capacity")).and_then(|value| value.parse().ok());
            }
            _ => {}
        }
    }
    status
}

fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_owned())
}
