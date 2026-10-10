use std::net::IpAddr;

use broski_link_core::crypto::MAX_LAN_ENTRIES;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::clock::{instant, now_ms};

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
}

impl Routes {
    pub fn new(relay: Option<String>) -> Routes {
        let (tx, rx) = watch::channel(Adverts {
            relay,
            lan: Vec::new(),
        });
        Routes { tx, rx }
    }

    pub fn current(&self) -> Adverts {
        self.rx.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<Adverts> {
        self.rx.clone()
    }

    /// Scans the interfaces now, so a pairing offer never races the first rescan.
    pub fn refresh(&self, port: u16) {
        let lan = scan(port);
        let mut next = self.rx.borrow().clone();
        if next.lan == lan {
            return;
        }
        next.lan = lan;
        let _ = self.tx.send(next);
    }
}

pub fn spawn(routes: Routes, port: u16, shutdown: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut shutdown = shutdown;
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(instant(now_ms() + SCAN_INTERVAL_MS)) => routes.refresh(port),
                _ = shutdown.wait_for(|stopped| *stopped) => return,
            }
        }
    })
}
fn scan(port: u16) -> Vec<String> {
    if port == 0 {
        return Vec::new();
    }
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
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
    lan.truncate(MAX_LAN_ENTRIES);
    lan
}
