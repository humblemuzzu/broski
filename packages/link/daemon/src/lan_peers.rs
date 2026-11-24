//! Which peers the LAN listener answers at all. It binds every interface so a phone on Wi-Fi,
//! Tailscale or an IPv6-only Personal Hotspot can reach it, which on a Mac with a public IPv6
//! address and no firewall would also make it reachable from the whole internet. A peer is local
//! when its address is private, Tailscale, link-local or loopback, or a global IPv6 address in
//! the same /64 as one of this Mac's own addresses (the network it shares with the phone); every
//! other peer is refused before a handshake costs anything, and the phone uses the relay instead.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// The /64 prefixes of this Mac's global IPv6 addresses right now.
pub fn local_v6_prefixes() -> Vec<[u16; 4]> {
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    interfaces
        .iter()
        .filter_map(|interface| match interface.ip() {
            IpAddr::V6(addr) if is_global_unicast_v6(addr) => Some(prefix64(addr)),
            _ => None,
        })
        .collect()
}

pub fn is_local_peer(ip: IpAddr, local_prefixes: &[[u16; 4]]) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(addr) => is_local_v4(addr),
        IpAddr::V6(addr) => {
            addr.is_loopback()
                || is_link_local_v6(addr)
                || is_ula_v6(addr)
                || (is_global_unicast_v6(addr) && local_prefixes.contains(&prefix64(addr)))
        }
    }
}

fn is_local_v4(addr: Ipv4Addr) -> bool {
    let [a, b, ..] = addr.octets();
    addr.is_loopback()
        || addr.is_private()
        || addr.is_link_local()
        || (a == 100 && (64..=127).contains(&b))
}

fn is_link_local_v6(addr: Ipv6Addr) -> bool {
    addr.segments()[0] & 0xffc0 == 0xfe80
}

fn is_ula_v6(addr: Ipv6Addr) -> bool {
    addr.segments()[0] & 0xfe00 == 0xfc00
}

fn is_global_unicast_v6(addr: Ipv6Addr) -> bool {
    addr.segments()[0] & 0xe000 == 0x2000
}

fn prefix64(addr: Ipv6Addr) -> [u16; 4] {
    let s = addr.segments();
    [s[0], s[1], s[2], s[3]]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> IpAddr {
        text.parse().expect("an address")
    }

    #[test]
    fn private_tailscale_link_local_and_loopback_peers_are_local() {
        for peer in [
            "127.0.0.1",
            "10.0.0.5",
            "172.16.4.2",
            "192.168.1.20",
            "169.254.3.4",
            "100.101.102.103",
            "::1",
            "fe80::1",
            "fd7a:115c:a1e0::1",
            "fd00::42",
            "::ffff:192.168.1.20",
        ] {
            assert!(is_local_peer(ip(peer), &[]), "{peer} is local");
        }
    }

    #[test]
    fn public_peers_are_refused() {
        for peer in [
            "8.8.8.8",
            "203.0.113.9",
            "100.128.0.1",
            "2001:db8::1",
            "::ffff:8.8.8.8",
        ] {
            assert!(!is_local_peer(ip(peer), &[]), "{peer} is not local");
        }
    }

    #[test]
    fn a_global_ipv6_peer_is_local_only_on_the_macs_own_slash_64() {
        let ours = [prefix64("2409:40c1:102d:a1ed::5".parse().expect("v6"))];
        assert!(is_local_peer(
            ip("2409:40c1:102d:a1ed:8cf:4312:d3d2:384f"),
            &ours
        ));
        assert!(!is_local_peer(ip("2409:40c1:102d:a1ee::9"), &ours));
        assert!(!is_local_peer(ip("2a00:1450:4001::200e"), &ours));
    }
}
