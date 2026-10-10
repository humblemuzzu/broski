mod common;

use broski_link_crypto::{HandshakeMode, PairingOffer, PublicBundle, Responder, StaticIdentity};

const CASES: usize = 2000;

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
}

fn mutate(rng: &mut Rng, bytes: &mut [u8]) {
    for _ in 0..=rng.below(4) {
        let index = rng.below(bytes.len());
        bytes[index] = rng.byte();
    }
}

fn sample(rng: &mut Rng, case: usize, connect_msg1: &[u8], pair_uri: &str) -> Vec<u8> {
    match case % 4 {
        0 => (0..rng.below(300)).map(|_| rng.byte()).collect(),
        1 => {
            let mut bytes = b"broski://pair?".to_vec();
            bytes.extend((0..rng.below(120)).map(|_| rng.byte()));
            bytes
        }
        2 => connect_msg1.to_vec(),
        _ => pair_uri.as_bytes().to_vec(),
    }
}

#[test]
fn random_inputs_never_panic() {
    let (initiator, responder) = common::identities();
    let mut session = common::connect(b"", b"");
    let mut rng = Rng(0x0123_4567_89ab_cdef);

    let connect_msg1 = common::first_message(
        &initiator,
        &responder.public(),
        HandshakeMode::Connect,
        b"payload",
    );
    let pair_uri = PairingOffer {
        fingerprint: [3u8; 32],
        secret: [4u8; 32],
        relay: Some("wss://relay.example/broski".to_string()),
        lan: vec!["10.0.0.2:8443".to_string()],
        name: "mac".to_string(),
        expires_at: 99,
    }
    .to_uri();

    for case in 0..CASES {
        let mut bytes = sample(&mut rng, case, &connect_msg1, &pair_uri);
        if case % 4 >= 2 {
            mutate(&mut rng, &mut bytes);
        }

        let _ = Responder::read_first(&responder, &bytes, || None);
        let _ = Responder::read_first(&responder, &bytes, || Some([0x11; 32]));
        let _ = PublicBundle::from_bytes(&bytes);
        let _ = StaticIdentity::from_secret_bytes(&bytes);
        let _ = PairingOffer::parse(&String::from_utf8_lossy(&bytes));
        let _ = common::open(&mut session.responder_transport, &bytes);
    }
}
