mod common;

use std::time::{Duration, Instant};

use broski_link_crypto::{
    HandshakeMode, Initiator, PublicBundle, Responder, StaticIdentity, MAX_PLAINTEXT,
};
use common::identities;

const HANDSHAKE_ROUNDS: u32 = 200;
const TRANSPORT_ROUNDS: u32 = 256;

fn connect_handshake(
    initiator: &StaticIdentity,
    responder: &StaticIdentity,
    bundle: &PublicBundle,
    mode: HandshakeMode,
) -> (Vec<u8>, Vec<u8>) {
    let (outgoing, msg1) = Initiator::start(initiator, bundle, mode, b"").expect("start");
    let (incoming, _, _, _) =
        Responder::read_first(responder, &msg1, || Some([9u8; 32])).expect("read_first");
    let (_, msg2) = incoming.reply(b"").expect("reply");
    let (_, reply) = outgoing.finish(&msg2).expect("finish");
    assert!(reply.is_empty());
    (msg1, msg2)
}

fn report_sizes(initiator: &StaticIdentity, responder: &StaticIdentity, bundle: &PublicBundle) {
    let (msg1, msg2) = connect_handshake(initiator, responder, bundle, HandshakeMode::Connect);
    let (pair_msg1, pair_msg2) = connect_handshake(
        initiator,
        responder,
        bundle,
        HandshakeMode::Pair { secret: [9u8; 32] },
    );
    assert_eq!(msg1.len(), pair_msg1.len());
    assert_eq!(msg2.len(), pair_msg2.len());

    println!(
        "msg1: connect {} bytes, pair {} bytes",
        msg1.len(),
        pair_msg1.len()
    );
    println!(
        "msg2: connect {} bytes, pair {} bytes",
        msg2.len(),
        pair_msg2.len()
    );
    println!(
        "identity secret: {} bytes, public bundle: {} bytes",
        initiator.to_secret_bytes().len(),
        bundle.to_bytes().len()
    );
}

fn handshake_time(
    initiator: &StaticIdentity,
    responder: &StaticIdentity,
    bundle: &PublicBundle,
) -> Duration {
    let start = Instant::now();
    for _ in 0..HANDSHAKE_ROUNDS {
        connect_handshake(initiator, responder, bundle, HandshakeMode::Connect);
    }
    start.elapsed() / HANDSHAKE_ROUNDS
}

fn throughput_mb_s() -> (f64, Duration) {
    let mut session = common::connect(b"", b"");
    let plaintext = vec![0x5au8; MAX_PLAINTEXT];
    let mut ciphertext = Vec::with_capacity(MAX_PLAINTEXT + 16);
    let mut decrypted = Vec::with_capacity(MAX_PLAINTEXT);

    let start = Instant::now();
    for _ in 0..TRANSPORT_ROUNDS {
        ciphertext.clear();
        decrypted.clear();
        session
            .initiator_transport
            .seal(&plaintext, &mut ciphertext)
            .expect("seal");
        session
            .responder_transport
            .open(&ciphertext, &mut decrypted)
            .expect("open");
        assert_eq!(decrypted.len(), plaintext.len());
    }
    let elapsed = start.elapsed();
    let mebibytes = f64::from(TRANSPORT_ROUNDS) * MAX_PLAINTEXT as f64 / (1024.0 * 1024.0);
    (
        mebibytes / elapsed.as_secs_f64(),
        elapsed / TRANSPORT_ROUNDS,
    )
}

#[test]
#[ignore]
fn measure_handshake_and_throughput() {
    let (initiator, responder) = identities();
    let bundle = responder.public();

    report_sizes(&initiator, &responder, &bundle);
    println!(
        "full connect handshake: {:?} average over {HANDSHAKE_ROUNDS} rounds",
        handshake_time(&initiator, &responder, &bundle)
    );

    let (megabytes_per_second, per_round) = throughput_mb_s();
    println!(
        "seal+open of {MAX_PLAINTEXT} byte messages into reused buffers: {megabytes_per_second:.1} MB/s ({TRANSPORT_ROUNDS} rounds, {per_round:?}/round)"
    );
}
