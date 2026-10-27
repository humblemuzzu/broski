mod common;

use broski_link_crypto::{HandshakeMode, PairingOffer, PublicBundle, Responder, StaticIdentity};

const CASES: usize = 2000;
/// One full hybrid handshake per case, so a case is slow enough to keep this smaller.
const SEALED_CASES: usize = 200;
const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";

struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next_u64() % bound as u64) as usize
    }

    fn byte(&mut self) -> u8 {
        self.next_u64() as u8
    }

    fn flip(&mut self, bytes: &mut [u8]) {
        if bytes.is_empty() {
            return;
        }
        let index = self.below(bytes.len());
        bytes[index] ^= 1 << self.below(8);
    }
}

fn noise(rng: &mut Rng, most: usize) -> Vec<u8> {
    (0..rng.below(most)).map(|_| rng.byte()).collect()
}

struct Fixtures {
    connect_msg1: Vec<u8>,
    pair_msg1: Vec<u8>,
    pair_uri: String,
    bundle: Vec<u8>,
    secret: Vec<u8>,
}

impl Fixtures {
    fn build() -> Fixtures {
        let (initiator, responder) = common::identities();
        let offer = PairingOffer {
            fingerprint: [3u8; 32],
            secret: [4u8; 32],
            relay: Some("wss://relay.example/broski".to_string()),
            lan: vec!["10.0.0.2:8443".to_string()],
            name: "mac".to_string(),
            expires_at: 99,
        };
        Fixtures {
            connect_msg1: common::first_message(
                &initiator,
                &responder.public(),
                HandshakeMode::Connect,
                b"payload",
            ),
            pair_msg1: common::first_message(
                &initiator,
                &responder.public(),
                HandshakeMode::Pair { secret: [4u8; 32] },
                b"payload",
            ),
            pair_uri: offer.to_uri(),
            bundle: responder.public().to_bytes().to_vec(),
            secret: initiator.to_secret_bytes().to_vec(),
        }
    }
}

/// Bytes that are not a msg1 the machine can answer: random, a truncated one, or one with a bit
/// flipped inside it. Every one of them must be refused, not merely survived.
#[test]
fn no_handshake_message_that_was_tampered_with_is_ever_accepted() {
    let (_, responder) = common::identities();
    let fixtures = Fixtures::build();
    let mut rng = Rng(0x0123_4567_89ab_cdef);
    for case in 0..CASES {
        let mut bytes = match case % 3 {
            0 => noise(&mut rng, 300),
            1 => {
                let mut message = fixtures.connect_msg1.clone();
                message.truncate(rng.below(message.len()));
                message
            }
            _ => {
                let mut message = fixtures.pair_msg1.clone();
                rng.flip(&mut message);
                message
            }
        };
        rng.flip(&mut bytes);
        assert!(
            Responder::read_first(&responder, &bytes, || None).is_err(),
            "case {case}: a tampered msg1 was accepted"
        );
        assert!(
            Responder::read_first(&responder, &bytes, || Some([0x11; 32])).is_err(),
            "case {case}: a tampered msg1 was accepted in pair mode"
        );
    }
}

#[test]
fn no_key_material_shorter_or_longer_than_the_real_thing_is_ever_accepted() {
    let fixtures = Fixtures::build();
    let mut rng = Rng(0x0f1e_2d3c_4b5a_6978);
    for case in 0..CASES {
        let mut bytes = noise(&mut rng, fixtures.bundle.len() + 40);
        rng.flip(&mut bytes);
        if bytes.len() != fixtures.bundle.len() {
            assert!(
                PublicBundle::from_bytes(&bytes).is_err(),
                "case {case}: a bundle of {} bytes was accepted",
                bytes.len()
            );
        }
        if bytes.len() != fixtures.secret.len() {
            assert!(
                StaticIdentity::from_secret_bytes(&bytes).is_err(),
                "case {case}: a secret of {} bytes was accepted",
                bytes.len()
            );
        }
    }
    assert!(
        StaticIdentity::from_secret_bytes(&fixtures.secret).is_ok(),
        "the real secret is the length a secret has to be"
    );
    assert!(PublicBundle::from_bytes(&fixtures.bundle).is_ok());
}

#[test]
fn no_sealed_frame_opens_under_a_tampered_ciphertext() {
    let mut rng = Rng(0x1234_5678_9abc_def0);
    for case in 0..SEALED_CASES {
        let mut session = common::connect(b"", b"");
        let ciphertext = common::seal(&mut session.initiator_transport, b"agent output");
        let mut tampered = ciphertext.clone();
        rng.flip(&mut tampered);
        assert!(
            common::open(&mut session.responder_transport, &tampered).is_err(),
            "case {case}: a frame with a flipped bit was opened"
        );
    }
    let mut session = common::connect(b"", b"");
    let ciphertext = common::seal(&mut session.initiator_transport, b"agent output");
    assert_eq!(
        common::open(&mut session.responder_transport, &ciphertext).expect("the real frame opens"),
        b"agent output"
    );
}

#[test]
fn a_pairing_uri_someone_altered_never_offers_another_machines_secret() {
    let fixtures = Fixtures::build();
    let offered = PairingOffer::parse(&fixtures.pair_uri).expect("the offer parses");
    let mut rng = Rng(0xdead_beef_cafe_f00d);

    for _ in 0..CASES {
        let bytes = noise(&mut rng, 200);
        assert!(
            PairingOffer::parse(&String::from_utf8_lossy(&bytes)).is_err(),
            "noise parsed as a pairing uri"
        );
    }

    // 32 secret bytes end mid-character: the last base64url character carries only two bits of
    // them, so the ones below that are free to change without changing the secret.
    let secret_at = fixtures.pair_uri.find("&s=").expect("the secret field") + 3;
    let secret_len = 42;
    for case in 0..CASES {
        let mut bytes = fixtures.pair_uri.clone().into_bytes();
        let index = secret_at + rng.below(secret_len);
        let mut replacement = ALPHABET[rng.below(ALPHABET.len())];
        while replacement == bytes[index] {
            replacement = ALPHABET[rng.below(ALPHABET.len())];
        }
        bytes[index] = replacement;
        let Ok(parsed) = PairingOffer::parse(&String::from_utf8_lossy(&bytes)) else {
            continue;
        };
        assert_ne!(
            parsed.secret, offered.secret,
            "case {case}: an altered secret parsed back into the one that was shown"
        );
        assert_eq!(parsed.fingerprint, offered.fingerprint);
    }
}
