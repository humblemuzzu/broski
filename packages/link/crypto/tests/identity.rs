use broski_link_crypto::{
    Error, HandshakeMode, Initiator, PublicBundle, Responder, StaticIdentity, PUBLIC_BUNDLE_LEN,
    SECRET_BYTES_LEN,
};

#[test]
fn secret_bytes_round_trip() {
    let identity = StaticIdentity::generate().expect("identity");
    let secret = identity.to_secret_bytes();
    assert_eq!(secret.len(), SECRET_BYTES_LEN);
    assert_eq!(secret[0], 1);

    let restored = StaticIdentity::from_secret_bytes(&secret).expect("restore");
    assert_eq!(restored.public(), identity.public());
    assert_eq!(restored.to_secret_bytes().as_slice(), secret.as_slice());
}

#[test]
fn restored_identity_completes_a_handshake() {
    let responder = StaticIdentity::from_secret_bytes(
        &StaticIdentity::generate()
            .expect("identity")
            .to_secret_bytes(),
    )
    .expect("restore");
    let initiator = StaticIdentity::generate().expect("identity");
    let (outgoing, msg1) = Initiator::start(
        &initiator,
        &responder.public(),
        HandshakeMode::Connect,
        b"hello",
    )
    .expect("start");
    let (incoming, peer, seen, _) =
        Responder::read_first(&responder, &msg1, || None).expect("read");
    assert_eq!(seen, b"hello");
    assert_eq!(peer, initiator.public());
    let (mut responder_transport, msg2) = incoming.reply(b"hi").expect("reply");
    let (mut initiator_transport, _) = outgoing.finish(&msg2).expect("finish");

    let mut out = Vec::new();
    initiator_transport.seal(b"ping", &mut out).expect("seal");
    let mut plain = Vec::new();
    responder_transport.open(&out, &mut plain).expect("open");
    assert_eq!(plain, b"ping");
}

#[test]
fn secret_bytes_are_strictly_validated() {
    let identity = StaticIdentity::generate().expect("identity");
    let secret = identity.to_secret_bytes();

    assert!(StaticIdentity::from_secret_bytes(&[]).is_err());
    assert!(StaticIdentity::from_secret_bytes(&secret[..SECRET_BYTES_LEN - 1]).is_err());

    let mut extended = secret.to_vec();
    extended.push(0);
    assert!(StaticIdentity::from_secret_bytes(&extended).is_err());

    let mut version = secret.to_vec();
    version[0] = 2;
    assert!(matches!(
        StaticIdentity::from_secret_bytes(&version),
        Err(Error::UnsupportedVersion(2))
    ));
}

#[test]
fn generated_identities_differ() {
    let first = StaticIdentity::generate().expect("identity");
    let second = StaticIdentity::generate().expect("identity");
    assert_ne!(first.public(), second.public());
    assert_ne!(first.public().id(), second.public().id());
}

#[test]
fn public_bundle_round_trips() {
    let bundle = StaticIdentity::generate().expect("identity").public();
    let bytes = bundle.to_bytes();
    assert_eq!(bytes.len(), PUBLIC_BUNDLE_LEN);
    assert_eq!(bytes[0], 1);
    assert_eq!(PublicBundle::from_bytes(&bytes).expect("parse"), bundle);
    assert_eq!(bundle.as_bytes(), &bytes);
}

#[test]
fn public_bundle_parsing_is_strict() {
    let bytes = StaticIdentity::generate()
        .expect("identity")
        .public()
        .to_bytes();

    assert!(PublicBundle::from_bytes(&[]).is_err());
    assert!(PublicBundle::from_bytes(&bytes[..PUBLIC_BUNDLE_LEN - 1]).is_err());

    let mut extended = bytes.to_vec();
    extended.push(0);
    assert!(PublicBundle::from_bytes(&extended).is_err());

    let mut version = bytes.to_vec();
    version[0] = 0;
    assert!(matches!(
        PublicBundle::from_bytes(&version),
        Err(Error::UnsupportedVersion(0))
    ));
}

#[test]
fn id_is_a_32_character_hex_prefix_of_the_fingerprint() {
    let bundle = StaticIdentity::generate().expect("identity").public();
    let fingerprint = bundle.fingerprint();
    let expected: String = fingerprint[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();

    let id = bundle.id();
    assert_eq!(id.len(), 32);
    assert_eq!(id, expected);
    assert!(id
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    assert_eq!(bundle.id(), bundle.id());
}

#[test]
fn debug_output_carries_no_key_material() {
    let identity = StaticIdentity::generate().expect("identity");
    assert_eq!(
        format!("{identity:?}"),
        format!("StaticIdentity {{ id: \"{}\" }}", identity.public().id())
    );
}
