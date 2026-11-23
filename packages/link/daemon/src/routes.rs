use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
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
    mdns_host: Option<String>,
}

impl Routes {
    pub fn new(relay: Option<String>, scan_interfaces: bool, mdns_host: Option<String>) -> Routes {
        let (tx, rx) = watch::channel(Adverts {
            relay,
            lan: Vec::new(),
        });
        Routes {
            tx,
            rx,
            scan_interfaces,
            mdns_host,
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
        let (lan, dropped) = scan(port, self.mdns_host.as_deref());
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

/// Routable non-loopback IPv4 and IPv6 addresses the listener serves, plus the mDNS `.local` name
/// when advertised. Excludes RFC 7335 CLAT46 (`192.0.0.0/29`) and link-local addresses.
fn scan(port: u16, mdns_host: Option<&str>) -> (Vec<String>, Vec<String>) {
    if port == 0 {
        return (Vec::new(), Vec::new());
    }
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return (Vec::new(), Vec::new());
    };
    let ips = interfaces
        .iter()
        .filter(|interface| interface.is_oper_up() && !interface.is_loopback())
        .map(if_addrs::Interface::ip);
    collect_routes(ips, port, mdns_host)
}

fn collect_routes(
    ips: impl IntoIterator<Item = IpAddr>,
    port: u16,
    mdns_host: Option<&str>,
) -> (Vec<String>, Vec<String>) {
    let mut lan_v4 = Vec::new();
    let mut cgnat_v4 = Vec::new();
    let mut ula_v6 = Vec::new();
    let mut global_v6: Vec<Ipv6Addr> = Vec::new();

    for ip in ips {
        match ip {
            IpAddr::V4(addr) if is_usable_v4(addr) => {
                if is_cgnat_v4(addr) {
                    cgnat_v4.push(format!("{addr}:{port}"));
                } else {
                    lan_v4.push(format!("{addr}:{port}"));
                }
            }
            IpAddr::V6(addr) if is_ula_v6(addr) => ula_v6.push(format!("[{addr}]:{port}")),
            IpAddr::V6(addr) if is_global_unicast_v6(addr) => global_v6.push(addr),
            _ => {}
        }
    }

    lan_v4.sort();
    lan_v4.dedup();
    cgnat_v4.sort();
    cgnat_v4.dedup();
    ula_v6.sort();
    ula_v6.dedup();
    global_v6.sort();
    global_v6.dedup();

    // Cap to 2 global IPv6 addresses per /64 prefix so macOS temporary/CLAT46 addresses never crowd
    // out Tailscale or `.local` entries past `MAX_LAN_ENTRIES`.
    let mut per_prefix: HashMap<[u16; 4], usize> = HashMap::new();
    let mut global_routes = Vec::new();
    for addr in global_v6 {
        let prefix = [
            addr.segments()[0],
            addr.segments()[1],
            addr.segments()[2],
            addr.segments()[3],
        ];
        let count = per_prefix.entry(prefix).or_insert(0);
        if *count < 2 {
            *count += 1;
            global_routes.push(format!("[{addr}]:{port}"));
        }
    }

    let mut lan = Vec::new();
    lan.extend(lan_v4);
    lan.extend(ula_v6);
    lan.extend(global_routes);
    lan.extend(cgnat_v4);
    if let Some(host) = mdns_host.filter(|h| !h.is_empty()) {
        let entry = format!("{host}:{port}");
        if !lan.contains(&entry) {
            lan.push(entry);
        }
    }
    if lan.len() <= MAX_LAN_ENTRIES {
        return (lan, Vec::new());
    }
    let dropped = lan.split_off(MAX_LAN_ENTRIES);
    (lan, dropped)
}

fn is_usable_v4(addr: Ipv4Addr) -> bool {
    !addr.is_loopback() && !addr.is_link_local() && !addr.is_unspecified() && !is_clat46_v4(addr)
}

/// RFC 7335 IPv4 Service Continuity Prefix (`192.0.0.0/29`), used locally by CLAT46 on iOS/macOS
/// IPv6-only hotspots (`192.0.0.2`) and unreachable from peers.
fn is_clat46_v4(addr: Ipv4Addr) -> bool {
    let [a, b, c, d] = addr.octets();
    a == 192 && b == 0 && c == 0 && d <= 7
}

fn is_cgnat_v4(addr: Ipv4Addr) -> bool {
    let [a, b, ..] = addr.octets();
    a == 100 && (64..=127).contains(&b)
}

fn is_ula_v6(addr: Ipv6Addr) -> bool {
    addr.segments()[0] & 0xfe00 == 0xfc00
}

fn is_global_unicast_v6(addr: Ipv6Addr) -> bool {
    addr.segments()[0] & 0xe000 == 0x2000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_scan_without_a_port_advertises_nothing() {
        assert_eq!(scan(0, None), (Vec::new(), Vec::new()));
    }

    #[tokio::test]
    async fn a_refresh_that_changes_nothing_is_not_a_change() {
        let routes = Routes::new(None, true, None);
        routes.refresh(0);
        assert!(!routes.refresh(0));
        assert!(routes.current().lan.is_empty());
    }

    #[test]
    fn clat46_ipv4_is_excluded_while_hotspot_ipv6_and_mdns_are_included() {
        let ips = [
            "192.0.0.2".parse::<IpAddr>().unwrap(),
            "169.254.1.5".parse::<IpAddr>().unwrap(),
            "100.101.102.103".parse::<IpAddr>().unwrap(),
            "fe80::1".parse::<IpAddr>().unwrap(),
            "2409:40c1:102d:a1ed:8cf:4312:d3d2:384f"
                .parse::<IpAddr>()
                .unwrap(),
            "2409:40c1:102d:a1ed:d535:dfbf:c08f:7311"
                .parse::<IpAddr>()
                .unwrap(),
            "2409:40c1:102d:a1ed:8a0:e6c5:97d9:19e"
                .parse::<IpAddr>()
                .unwrap(),
            "fd00::42".parse::<IpAddr>().unwrap(),
        ];
        let (lan, dropped) = collect_routes(ips, 18275, Some("mac-01234567.local"));
        assert!(dropped.is_empty());
        assert!(!lan.iter().any(|r| r.starts_with("192.0.0.")));
        assert!(!lan.iter().any(|r| r.starts_with("169.254.")));
        assert!(!lan.iter().any(|r| r.starts_with("[fe80:")));
        assert_eq!(lan[0], "[fd00::42]:18275");
        assert!(lan.contains(&"100.101.102.103:18275".to_owned()));
        assert!(lan.contains(&"mac-01234567.local:18275".to_owned()));
        let v6_global_count = lan.iter().filter(|r| r.starts_with("[2409:")).count();
        assert_eq!(v6_global_count, 2, "capped to 2 per /64 prefix");
    }
}
