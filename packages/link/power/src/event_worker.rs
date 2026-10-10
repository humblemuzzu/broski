use std::io;
use std::sync::mpsc::{self, Receiver, Sender, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::{EventHandler, PowerEvent};

pub(crate) enum Notification {
    WillSleep(SyncSender<()>),
    DidWake,
}

/// Runs `on_event` on a thread of its own, so the thread that owns the OS registration stays free
/// to give up on a slow handler. Dropping the returned sender ends the thread.
pub(crate) fn spawn(on_event: EventHandler) -> io::Result<(Sender<Notification>, JoinHandle<()>)> {
    let (notify, events) = mpsc::channel::<Notification>();
    let thread = thread::Builder::new()
        .name("broski-power-events".to_owned())
        .spawn(move || dispatch(on_event, events))?;
    Ok((notify, thread))
}

/// Hands `event` to the worker. For [`PowerEvent::WillSleep`] it waits for the handler to finish,
/// but never longer than `grace`.
pub(crate) fn report(notify: &Sender<Notification>, event: PowerEvent, grace: Duration) {
    match event {
        PowerEvent::WillSleep => {
            let (done_tx, done_rx) = mpsc::sync_channel(0);
            if notify.send(Notification::WillSleep(done_tx)).is_ok() {
                let _ = done_rx.recv_timeout(grace);
            }
        }
        PowerEvent::DidWake => {
            let _ = notify.send(Notification::DidWake);
        }
    }
}

fn dispatch(on_event: EventHandler, events: Receiver<Notification>) {
    while let Ok(notification) = events.recv() {
        match notification {
            Notification::WillSleep(done) => {
                on_event(PowerEvent::WillSleep);
                let _ = done.send(());
            }
            Notification::DidWake => on_event(PowerEvent::DidWake),
        }
    }
}
