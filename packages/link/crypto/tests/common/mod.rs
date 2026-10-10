#![allow(dead_code)]

use broski_link_crypto::{
    Error, HandshakeMode, HandshakeModeKind, Initiator, PublicBundle, Responder, StaticIdentity,
    Transport,
};

pub struct Session {
    pub initiator_transport: Transport,
    pub responder_transport: Transport,
    pub initiator_payload: Vec<u8>,
    pub responder_payload: Vec<u8>,
}

pub fn identities() -> (StaticIdentity, StaticIdentity) {
    (
        StaticIdentity::generate().expect("identity"),
        StaticIdentity::generate().expect("identity"),
    )
}

pub fn connect(initiator_payload: &[u8], responder_payload: &[u8]) -> Session {
    let (initiator, responder) = identities();
    let bundle = responder.public();
    let (outgoing, msg1) = Initiator::start(
        &initiator,
        &bundle,
        HandshakeMode::Connect,
        initiator_payload,
    )
    .expect("start");
    let (incoming, peer, seen, kind) =
        Responder::read_first(&responder, &msg1, || None).expect("read_first");
    assert_eq!(kind, HandshakeModeKind::Connect);
    assert_eq!(peer, initiator.public());
    let (responder_transport, msg2) = incoming.reply(responder_payload).expect("reply");
    let (initiator_transport, reply_payload) = outgoing.finish(&msg2).expect("finish");
    assert_eq!(reply_payload, responder_payload);
    Session {
        initiator_transport,
        responder_transport,
        initiator_payload: seen,
        responder_payload: reply_payload,
    }
}

pub fn pair(
    initiator_secret: [u8; 32],
    responder_secret: Option<[u8; 32]>,
    initiator_payload: &[u8],
    responder_payload: &[u8],
) -> Result<(Transport, Transport), Error> {
    let (initiator, responder) = identities();
    let bundle = responder.public();
    let (outgoing, msg1) = Initiator::start(
        &initiator,
        &bundle,
        HandshakeMode::Pair {
            secret: initiator_secret,
        },
        initiator_payload,
    )?;
    let (incoming, _, _, kind) = Responder::read_first(&responder, &msg1, || responder_secret)?;
    assert_eq!(kind, HandshakeModeKind::Pair);
    let (responder_transport, msg2) = incoming.reply(responder_payload)?;
    let (initiator_transport, _) = outgoing.finish(&msg2)?;
    Ok((initiator_transport, responder_transport))
}

pub fn first_message(
    initiator: &StaticIdentity,
    responder: &PublicBundle,
    mode: HandshakeMode,
    payload: &[u8],
) -> Vec<u8> {
    Initiator::start(initiator, responder, mode, payload)
        .expect("start")
        .1
}

pub fn seal(transport: &mut Transport, plaintext: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    transport.seal(plaintext, &mut out).expect("seal");
    out
}

pub fn open(transport: &mut Transport, ciphertext: &[u8]) -> Result<Vec<u8>, Error> {
    let mut out = Vec::new();
    transport.open(ciphertext, &mut out)?;
    Ok(out)
}
