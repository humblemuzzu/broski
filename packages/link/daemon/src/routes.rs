use std::net::IpAddr;
use std::sync::Arc;

use broski_link_core::crypto::MAX_LAN_ENTRIES;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tracing::warn;

use crate::clock::{instant, now_ms};
use crate::discovery::Advertisement;

const SCAN_INTERVAL_MS: u64 = 10_000;

#[derive(Clone, PartialEq, Eq, Default)]
pub struct Adverts {
    pub relay: Option<String>,
    pub lan: Vec<String>,
}

/// What the machine tells every connected device it can be reached on.
#[derive(Clone)]
pub struct Routes {
    tx: watch::Sender<Adverts>,
    rx: watch::Receiver<Adverts>,
    scan_interfaces: bool,
}

impl Routes {
    pub fn new(relay: Option<String>, scan_interfaces: bool) -> Routes {
        let (tx, rx) = watch::channel(Adverts {
            relay,
            lan: Vec::new(),
        });
        Routes {
            tx,
            rx,
            scan_interfaces,
        }
    }

    pub fn current(&self) -> Adverts {
        self.rx.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<Adverts> {
        self.rx.clone()
    }

    /// Scans the interfaces now, so a pairing offer never races the first rescan. True when the
    /// advertised addresses changed.
    pub fn refresh(&self, port: u16) -> bool {
        if !self.scan_interfaces {
            return false;
        }
        let (lan, dropped) = scan(port);
        let mut next = self.rx.borrow().clone();
        if next.lan == lan {
            return false;
        }
        if !dropped.is_empty() {
            warn!(
                dropped = ?dropped,
                limit = MAX_LAN_ENTRIES,
                "more lan addresses than the machine can advertise; these are left out"
            );
        }
        next.lan = lan;
        let _ = self.tx.send(next);
        true
    }
}

pub fn spawn(
    routes: Routes,
    port: u16,
    advertisement: Option<Arc<Advertisement>>,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut shutdown = shutdown;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(instant(now_ms() + SCAN_INTERVAL_MS)) => {
                    if routes.refresh(port) {
                        if let Some(advertisement) = &advertisement {
                            advertisement.refresh();
                        }
                    }
                }
                _ = shutdown.wait_for(|stopped| *stopped) => return,
            }
        }
    })
}

/// Every non-loopback IPv4 address the listener serves, and the ones past the advertised limit.
fn scan(port: u16) -> (Vec<String>, Vec<String>) {
    if port == 0 {
        return (Vec::new(), Vec::new());
    }
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return (Vec::new(), Vec::new());
    };
    let mut lan: Vec<String> = interfaces
        .iter()
        .filter(|interface| interface.is_oper_up() && !interface.is_loopback())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(address) if !address.is_link_local() => Some(format!("{address}:{port}")),
            _ => None,
        })
        .collect();
    lan.sort();
    lan.dedup();
    if lan.len() <= MAX_LAN_ENTRIES {
        return (lan, Vec::new());
    }
    let dropped = lan.split_off(MAX_LAN_ENTRIES);
    (lan, dropped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_scan_without_a_port_advertises_nothing() {
        assert_eq!(scan(0), (Vec::new(), Vec::new()));
    }

    #[tokio::test]
    async fn a_refresh_that_changes_nothing_is_not_a_change() {
        let routes = Routes::new(None, true);
        routes.refresh(0);
        assert!(!routes.refresh(0));
        assert!(routes.current().lan.is_empty());
    }
}
