use broski_link_crypto::{Error, PairingOffer, MAX_LAN_ENTRIES, MAX_NAME_LEN};

fn offer() -> PairingOffer {
    PairingOffer {
        fingerprint: [0xab; 32],
        secret: [0xcd; 32],
        relay: Some("wss://relay.example.ts.net/broski?token=abc".to_string()),
        lan: vec![
            "192.168.1.20:8443".to_string(),
            "mac-mini.local:8443".to_string(),
        ],
        name: "Sam's Mac / caf\u{e9}".to_string(),
        expires_at: 1_800_000_000,
    }
}

fn minimal() -> PairingOffer {
    with_relay(None)
}

fn with_relay(relay: Option<String>) -> PairingOffer {
    PairingOffer {
        fingerprint: [1u8; 32],
        secret: [2u8; 32],
        relay,
        lan: Vec::new(),
        name: "mac".to_string(),
        expires_at: 7,
    }
}

fn assert_same(left: &PairingOffer, right: &PairingOffer) {
    assert_eq!(left.fingerprint, right.fingerprint);
    assert_eq!(left.secret, right.secret);
    assert_eq!(left.relay, right.relay);
    assert_eq!(left.lan, right.lan);
    assert_eq!(left.name, right.name);
    assert_eq!(left.expires_at, right.expires_at);
}

const PREFIX: &str = "broski://pair?";

fn query(uri: &str) -> Vec<String> {
    uri.trim_start_matches(PREFIX)
        .split('&')
        .map(str::to_string)
        .collect()
}

fn rebuild(parts: Vec<String>) -> String {
    format!("{PREFIX}{}", parts.join("&"))
}

fn without(uri: &str, key: &str) -> String {
    let prefix = format!("{key}=");
    rebuild(
        query(uri)
            .into_iter()
            .filter(|part| !part.starts_with(&prefix))
            .collect(),
    )
}

fn patch(uri: &str, key: &str, value: &str) -> String {
    let prefix = format!("{key}=");
    let mut parts = query(uri);
    let mut replaced = false;
    for part in &mut parts {
        if part.starts_with(&prefix) {
            *part = format!("{prefix}{value}");
            replaced = true;
        }
    }
    if !replaced {
        parts.push(format!("{prefix}{value}"));
    }
    rebuild(parts)
}

#[test]
fn round_trips_every_field() {
    let source = offer();
    let uri = source.to_uri();
    let parsed = PairingOffer::parse(&uri).expect("parse");
    assert_same(&source, &parsed);
    assert_eq!(parsed.to_uri(), uri);
}

#[test]
fn writes_the_documented_grammar() {
    let uri = minimal().to_uri();
    assert_eq!(
        uri,
        concat!(
            "broski://pair?v=2",
            "&h=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
            "&s=AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
            "&e=7&n=mac"
        )
    );
    assert_same(&minimal(), &PairingOffer::parse(&uri).expect("parse"));
}

#[test]
fn expiry_is_inclusive() {
    let source = minimal();
    assert!(!source.is_expired(6));
    assert!(source.is_expired(7));
    assert!(source.is_expired(8));
}

#[test]
fn rejects_unknown_prefix_and_version() {
    assert!(matches!(
        PairingOffer::parse("https://pair?v=2"),
        Err(Error::NotAPairUri)
    ));
    assert!(matches!(
        PairingOffer::parse("broski://pair"),
        Err(Error::NotAPairUri)
    ));

    let replaced = patch(&minimal().to_uri(), "v", "3");
    assert!(matches!(
        PairingOffer::parse(&replaced),
        Err(Error::UnsupportedVersion(3))
    ));

    let garbage = patch(&minimal().to_uri(), "v", "two");
    assert!(matches!(
        PairingOffer::parse(&garbage),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn rejects_wrong_key_lengths() {
    let uri = minimal().to_uri();
    for (key, value) in [
        ("h", "AAAAAAAAAAA"),
        ("h", ""),
        ("h", "!!!"),
        ("h", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="),
        ("s", "AAAAAAAAAAA"),
        ("s", ""),
        ("s", "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB"),
    ] {
        assert!(
            PairingOffer::parse(&patch(&uri, key, value)).is_err(),
            "accepted {key}={value}"
        );
    }
}

#[test]
fn rejects_wrong_expiry() {
    let uri = minimal().to_uri();
    for value in ["", "seven", "-1", "99999999999999999999"] {
        assert!(
            PairingOffer::parse(&patch(&uri, "e", value)).is_err(),
            "accepted e={value}"
        );
    }
}

#[test]
fn rejects_missing_parameters() {
    let uri = offer().to_uri();
    for key in ["v", "h", "s", "e", "n"] {
        assert!(
            PairingOffer::parse(&without(&uri, key)).is_err(),
            "accepted a uri without {key}"
        );
    }
}

#[test]
fn rejects_duplicate_and_unknown_parameters() {
    let duplicated = format!("{}&n=other", minimal().to_uri());
    assert!(matches!(
        PairingOffer::parse(&duplicated),
        Err(Error::Malformed(_))
    ));

    let unknown = format!("{}&x=1", minimal().to_uri());
    assert!(matches!(
        PairingOffer::parse(&unknown),
        Err(Error::Malformed(_))
    ));

    let valueless = format!("{}&x", minimal().to_uri());
    assert!(matches!(
        PairingOffer::parse(&valueless),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn enforces_the_name_limit() {
    let mut source = minimal();
    source.name = "a".repeat(MAX_NAME_LEN);
    assert!(PairingOffer::parse(&source.to_uri()).is_ok());

    source.name = "a".repeat(MAX_NAME_LEN + 1);
    assert!(matches!(
        PairingOffer::parse(&source.to_uri()),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn rejects_broken_percent_escapes_in_names() {
    let uri = minimal().to_uri();
    assert!(PairingOffer::parse(&patch(&uri, "n", "%ff")).is_err());
    assert!(PairingOffer::parse(&patch(&uri, "n", "%f")).is_err());
    assert_eq!(
        PairingOffer::parse(&patch(&uri, "n", "a%20b"))
            .expect("parse")
            .name,
        "a b"
    );
}

#[test]
fn enforces_the_lan_entry_limit() {
    let mut source = minimal();
    source.lan = (0..MAX_LAN_ENTRIES)
        .map(|index| format!("10.0.0.{index}:443"))
        .collect();
    let uri = source.to_uri();
    assert_eq!(
        PairingOffer::parse(&uri).expect("parse").lan.len(),
        MAX_LAN_ENTRIES
    );

    source.lan.push("10.0.0.99:443".to_string());
    assert!(matches!(
        PairingOffer::parse(&source.to_uri()),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn rejects_malformed_lan_entries() {
    let uri = minimal().to_uri();
    for entry in [
        "",
        "host",
        ":1234",
        "host:",
        "host:0",
        "host:70000",
        "host:12a",
        "ho st:1234",
        "host:1234:",
        "[::1]",
        "[not-an-ip]:1234",
        "[::1]:0",
    ] {
        assert!(
            PairingOffer::parse(&patch(&uri, "l", entry)).is_err(),
            "accepted lan entry {entry:?}"
        );
    }
    let v6_uri = patch(&uri, "l", "[2409:40c1:102d:a1ed::1]:18275,10.0.0.1:18275");
    assert_eq!(
        PairingOffer::parse(&v6_uri).expect("ipv6 offer").lan,
        ["[2409:40c1:102d:a1ed::1]:18275", "10.0.0.1:18275"]
    );
}

#[test]
fn enforces_the_relay_scheme() {
    for scheme in ["wss://", "ws://"] {
        let source = with_relay(Some(format!("{scheme}relay.example:8443/x")));
        let parsed = PairingOffer::parse(&source.to_uri()).expect("parse");
        assert_eq!(parsed.relay, source.relay);
    }

    for scheme in ["http://", "https://", "relay.example"] {
        let value = scheme.replace(':', "%3A").replace('/', "%2F");
        assert!(
            PairingOffer::parse(&patch(&minimal().to_uri(), "r", &value)).is_err(),
            "accepted relay {scheme:?}"
        );
    }
}

#[test]
fn debug_output_redacts_the_pairing_secret() {
    let source = offer();
    let rendered = format!("{source:?}");
    assert!(rendered.contains("<redacted>"));
    assert!(rendered.contains(&source.name));

    let uri = source.to_uri();
    let secret = uri
        .split('&')
        .find_map(|part| part.strip_prefix("s="))
        .expect("secret parameter");
    assert!(!rendered.contains(secret));
}
