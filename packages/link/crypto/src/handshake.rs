use core::fmt;

use clatter::traits::Handshaker;
use clatter::HybridHandshakeParams;
use zeroize::{Zeroize, Zeroizing};

use crate::error::{Error, Result};
use crate::identity::{PublicBundle, StaticIdentity};
use crate::suite::{self, Handshake, MAX_NOISE_MESSAGE};
use crate::transport::Transport;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_HANDSHAKE_PAYLOAD: usize = 4096;

const HEADER_LEN: usize = 2;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HandshakeModeKind {
    Connect = 0,
    Pair = 1,
}

impl HandshakeModeKind {
    pub(crate) const fn as_byte(self) -> u8 {
        self as u8
    }

    fn from_byte(byte: u8) -> Result<Self> {
        match byte {
            0 => Ok(Self::Connect),
            1 => Ok(Self::Pair),
            _ => Err(Error::Malformed("handshake mode")),
        }
    }
}

pub enum HandshakeMode {
    Connect,
    Pair { secret: [u8; 32] },
}

impl HandshakeMode {
    fn kind(&self) -> HandshakeModeKind {
        match self {
            Self::Connect => HandshakeModeKind::Connect,
            Self::Pair { .. } => HandshakeModeKind::Pair,
        }
    }
}

impl Drop for HandshakeMode {
    fn drop(&mut self) {
        if let Self::Pair { secret } = self {
            secret.zeroize();
        }
    }
}

impl fmt::Debug for HandshakeMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Connect => f.write_str("Connect"),
            Self::Pair { .. } => f.write_str("Pair { secret: <redacted> }"),
        }
    }
}

pub struct Initiator {
    handshake: Handshake,
}

impl Initiator {
    pub fn start(
        identity: &StaticIdentity,
        responder: &PublicBundle,
        mode: HandshakeMode,
        payload: &[u8],
    ) -> Result<(Self, Vec<u8>)> {
        if payload.len() > MAX_HANDSHAKE_PAYLOAD {
            return Err(Error::PayloadTooLarge {
                len: payload.len(),
                max: MAX_HANDSHAKE_PAYLOAD,
            });
        }

        let kind = mode.kind();
        let prologue = suite::prologue(kind);
        let params = HybridHandshakeParams::new(suite::pattern(kind), true)
            .with_prologue(&prologue)
            .with_s(identity.dh().clone())
            .with_s_kem(identity.kem().clone())
            .with_rs(responder.dh_public())
            .with_rs_kem(responder.kem_public());
        let mut handshake = Handshake::new(params)?;

        if let HandshakeMode::Pair { secret } = &mode {
            handshake.push_psk(&Zeroizing::new(*secret)[..]);
        }

        let overhead = handshake.get_next_message_overhead()?;
        let mut noise = vec![0u8; payload.len() + overhead];
        let written = handshake.write_message(payload, &mut noise)?;
        noise.truncate(written);

        let mut message = Vec::with_capacity(written + HEADER_LEN);
        message.push(PROTOCOL_VERSION);
        message.push(kind.as_byte());
        message.extend_from_slice(&noise);
        Ok((Self { handshake }, message))
    }

    pub fn finish(mut self, msg2: &[u8]) -> Result<(Transport, Vec<u8>)> {
        if msg2.len() > MAX_NOISE_MESSAGE {
            return Err(Error::MessageTooLarge {
                len: msg2.len(),
                max: MAX_NOISE_MESSAGE,
            });
        }

        let mut payload = vec![0u8; msg2.len()];
        let written = self.handshake.read_message(msg2, &mut payload)?;
        payload.truncate(written);

        let transport = self.handshake.finalize()?;
        Ok((Transport::new(transport), payload))
    }
}

pub struct Responder {
    handshake: Handshake,
}

impl Responder {
    pub fn read_first(
        identity: &StaticIdentity,
        msg1: &[u8],
        pairing_secret: impl FnOnce() -> Option<[u8; 32]>,
    ) -> Result<(Self, PublicBundle, Vec<u8>, HandshakeModeKind)> {
        if msg1.len() < HEADER_LEN {
            return Err(Error::Malformed("handshake header"));
        }
        if msg1[0] != PROTOCOL_VERSION {
            return Err(Error::UnsupportedVersion(msg1[0]));
        }
        let kind = HandshakeModeKind::from_byte(msg1[1])?;

        let noise = &msg1[HEADER_LEN..];
        if noise.len() > MAX_NOISE_MESSAGE {
            return Err(Error::MessageTooLarge {
                len: noise.len(),
                max: MAX_NOISE_MESSAGE,
            });
        }

        let prologue = suite::prologue(kind);
        let params = HybridHandshakeParams::new(suite::pattern(kind), false)
            .with_prologue(&prologue)
            .with_s(identity.dh().clone())
            .with_s_kem(identity.kem().clone());
        let mut handshake = Handshake::new(params)?;

        if kind == HandshakeModeKind::Pair {
            let secret = Zeroizing::new(pairing_secret().ok_or(Error::PairingSecretRequired)?);
            handshake.push_psk(&secret[..]);
        }

        let mut payload = vec![0u8; noise.len()];
        let written = handshake.read_message(noise, &mut payload)?;
        payload.truncate(written);

        let initiator = handshake
            .get_remote_static()
            .ok_or(Error::Malformed("missing initiator static key"))?;
        let bundle = PublicBundle::from_parts(initiator.dh(), initiator.kem());

        Ok((Self { handshake }, bundle, payload, kind))
    }

    pub fn reply(mut self, payload: &[u8]) -> Result<(Transport, Vec<u8>)> {
        if payload.len() > MAX_HANDSHAKE_PAYLOAD {
            return Err(Error::PayloadTooLarge {
                len: payload.len(),
                max: MAX_HANDSHAKE_PAYLOAD,
            });
        }

        let overhead = self.handshake.get_next_message_overhead()?;
        let mut msg2 = vec![0u8; payload.len() + overhead];
        let written = self.handshake.write_message(payload, &mut msg2)?;
        msg2.truncate(written);

        let transport = self.handshake.finalize()?;
        Ok((Transport::new(transport), msg2))
    }
}
