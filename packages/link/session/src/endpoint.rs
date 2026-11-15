use std::net::{Ipv4Addr, Ipv6Addr};

use url::{Host, Url};

use crate::status::Route;

/// One socket the session can dial.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    pub(crate) route: Route,
    pub(crate) url: String,
    pub(crate) headers: Vec<(&'static str, String)>,
    /// `host:port` for a LAN candidate, the host for the relay.
    pub(crate) detail: String,
}

/// The relay credentials a device socket authenticates with.
pub(crate) struct RelayAuth<'a> {
    pub(crate) machine_id: &'a str,
    pub(crate) device_id: &'a str,
    pub(crate) token: &'a str,
}

/// `ws://<host:port>/v1/link` for one LAN candidate, or `None` when the candidate is not a
/// `host:port` on a private network. The Noise handshake authenticates whatever answers, so the
/// rule is not about trust: it keeps a spoofed advert or a tampered offer from making the phone
/// dial an arbitrary host on the internet.
pub(crate) fn lan_target(candidate: &str) -> Option<Target> {
    let url = Url::parse(&format!("ws://{candidate}/v1/link")).ok()?;
    let plain = url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.path() == "/v1/link";
    // `port()` hides a scheme's default port, and a candidate must name its port either way.
    let port = url.port_or_known_default()?;
    let host = url.host()?;
    if !plain || !candidate.ends_with(&format!(":{port}")) || !is_private_host(&host) {
        return None;
    }
    let detail = format!("{host}:{port}");
    Some(Target {
        route: Route::Lan,
        url: format!("ws://{detail}/v1/link"),
        headers: Vec::new(),
        detail,
    })
}

/// The relay's device socket with the headers of `relay-protocol.md`, or `None` when the relay
/// address cannot carry the bearer token: plaintext `ws://` is refused off private hosts, so a
/// tampered record cannot downgrade the token to cleartext.
pub(crate) fn relay_target(relay: &str, auth: &RelayAuth<'_>) -> Option<Target> {
    let url = relay_url(relay, "/v1/device", ["ws", "wss"])?;
    Some(Target {
        route: Route::Relay,
        detail: url.host_str()?.to_owned(),
        url: url.into(),
        headers: vec![
            ("x-broski-machine", auth.machine_id.to_owned()),
            ("x-broski-device", auth.device_id.to_owned()),
            ("authorization", format!("Bearer {}", auth.token)),
        ],
    })
}

/// The relay's HTTP endpoint at `path`: `https` for a `wss` relay, `http` for a `ws` one on a
/// private host, under the same rule as the device socket.
pub(crate) fn relay_http(relay: &str, path: &str) -> Option<Url> {
    relay_url(relay, path, ["http", "https"])
}

/// Whether `text` is a relay address the session can use at all.
pub(crate) fn valid_relay(text: &str) -> bool {
    Url::parse(text).is_ok_and(|url| matches!(url.scheme(), "ws" | "wss") && url.host().is_some())
}

/// Keeps scheme, host and port of `relay` and replaces the rest with `path`; `schemes` names the
/// plain and the TLS scheme to use.
fn relay_url(relay: &str, path: &str, [plain, tls]: [&str; 2]) -> Option<Url> {
    let base = Url::parse(relay).ok()?;
    let host = base.host()?;
    let scheme = match base.scheme() {
        "wss" => tls,
        "ws" if is_private_host(&host) => plain,
        _ => return None,
    };
    let port = base
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Url::parse(&format!("{scheme}://{host}{port}{path}")).ok()
}

/// Loopback, RFC 1918, CGNAT (Tailscale), IPv6 unique-local and link-local, `localhost` and mDNS
/// `.local` names.
pub(crate) fn is_private_host(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(name) => *name == "localhost" || name.ends_with(".local"),
        Host::Ipv4(address) => private_v4(*address),
        Host::Ipv6(address) => private_v6(*address),
    }
}

fn private_v4(address: Ipv4Addr) -> bool {
    let [a, b, ..] = address.octets();
    a == 127
        || a == 10
        || (a == 192 && b == 168)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 100 && (64..=127).contains(&b))
}

fn private_v6(address: Ipv6Addr) -> bool {
    let first = address.segments()[0];
    address.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTH: RelayAuth<'static> = RelayAuth {
        machine_id: "machine-1",
        device_id: "device-1",
        token: "token",
    };

    fn relay(text: &str) -> Option<String> {
        relay_target(text, &AUTH).map(|target| target.url)
    }

    #[test]
    fn a_lan_candidate_is_plain_ws_on_its_own_host_and_port() {
        let target = lan_target("10.0.0.4:99").expect("private");
        assert_eq!(target.url, "ws://10.0.0.4:99/v1/link");
        assert_eq!(target.detail, "10.0.0.4:99");
        assert_eq!(
            lan_target("[fe80::1]:7").expect("link-local").url,
            "ws://[fe80::1]:7/v1/link"
        );
        assert_eq!(
            lan_target("studio.local:1").expect("mdns").detail,
            "studio.local:1"
        );
    }

    #[test]
    fn a_lan_candidate_off_the_private_network_or_malformed_is_not_dialled() {
        for candidate in [
            "8.8.8.8:80",
            "relay.example:1",
            "10.0.0.4",
            "a@10.0.0.4:1",
            "10.0.0.4:1/x",
        ] {
            assert_eq!(lan_target(candidate), None, "{candidate}");
        }
    }

    #[test]
    fn the_relay_device_socket_replaces_the_base_path_and_keeps_the_port() {
        assert_eq!(
            relay("wss://relay.example/prefix?x=1").as_deref(),
            Some("wss://relay.example/v1/device")
        );
        assert_eq!(
            relay("wss://relay.example:8443").as_deref(),
            Some("wss://relay.example:8443/v1/device")
        );
    }

    #[test]
    fn plaintext_ws_is_only_allowed_towards_loopback_or_private_hosts() {
        assert_eq!(
            relay("ws://127.0.0.1:8080").as_deref(),
            Some("ws://127.0.0.1:8080/v1/device")
        );
        assert!(relay("ws://[::1]:8080").is_some());
        assert!(relay("wss://93.184.216.34").is_some());
        for refused in [
            "ws://relay.example",
            "ws://93.184.216.34",
            "https://relay.example",
        ] {
            assert_eq!(relay(refused), None, "{refused}");
        }
        assert_eq!(
            relay_http("wss://relay.example/x", "/v1/letters")
                .map(String::from)
                .as_deref(),
            Some("https://relay.example/v1/letters")
        );
        assert_eq!(relay_http("ws://relay.example", "/v1/letters"), None);
    }

    #[test]
    fn relay_headers_carry_both_ids_and_the_bearer_token() {
        let target = relay_target("wss://relay.example", &AUTH).expect("relay");
        assert_eq!(
            target.headers,
            [
                ("x-broski-machine", "machine-1".to_owned()),
                ("x-broski-device", "device-1".to_owned()),
                ("authorization", "Bearer token".to_owned()),
            ]
        );
        assert_eq!(target.detail, "relay.example");
    }

    #[test]
    fn loopback_private_and_cgnat_hosts_are_recognised() {
        let private = |text: &str| {
            let host = match Host::parse(text).expect("host") {
                Host::Domain(name) => return is_private_host(&Host::Domain(name.as_str())),
                Host::Ipv4(address) => Host::Ipv4(address),
                Host::Ipv6(address) => Host::Ipv6(address),
            };
            is_private_host(&host)
        };
        for host in [
            "localhost",
            "mac.local",
            "127.0.0.1",
            "[::1]",
            "10.1.2.3",
            "192.168.0.9",
            "172.16.0.1",
            "172.31.255.1",
            "100.101.102.103",
            "[fd00::1]",
            "[fe80::1]",
        ] {
            assert!(private(host), "{host}");
        }
        for host in [
            "relay.example",
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "[2a00:1450::1]",
            "[fe00::1]",
        ] {
            assert!(!private(host), "{host}");
        }
    }
}
