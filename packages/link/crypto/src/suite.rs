use clatter::bytearray::ByteArray;
use clatter::crypto::cipher::AesGcm;
use clatter::crypto::dh::X25519;
use clatter::crypto::hash::Sha256;
use clatter::crypto::kem::rust_crypto_ml_kem::MlKem768;
use clatter::handshakepattern::{self, HandshakePattern};
use clatter::traits::{Dh, Kem};
use clatter::HybridHandshake;
use clatter::KeyPair;

use crate::handshake::HandshakeModeKind;

pub const SUITE: &str = "Noise_hybridIK_X25519+MLKEM768_AESGCM_SHA256";

pub(crate) const X25519_PUBLIC_LEN: usize = <<X25519 as Dh>::PubKey as ByteArray>::LENGTH;
pub(crate) const X25519_SECRET_LEN: usize = <<X25519 as Dh>::PrivateKey as ByteArray>::LENGTH;
pub(crate) const KEM_PUBLIC_LEN: usize = <<MlKem768 as Kem>::PubKey as ByteArray>::LENGTH;
pub(crate) const KEM_SECRET_LEN: usize = <<MlKem768 as Kem>::SecretKey as ByteArray>::LENGTH;
pub(crate) const TAG_LEN: usize = 16;
pub(crate) const MAX_NOISE_MESSAGE: usize = clatter::constants::MAX_MESSAGE_LEN;

pub(crate) type Handshake = HybridHandshake<X25519, MlKem768, MlKem768, AesGcm, Sha256>;
pub(crate) type TransportState = clatter::transportstate::TransportState<AesGcm, Sha256>;
pub(crate) type DhPublicKey = <X25519 as Dh>::PubKey;
pub(crate) type DhPrivateKey = <X25519 as Dh>::PrivateKey;
pub(crate) type DhKeyPair = KeyPair<DhPublicKey, DhPrivateKey>;
pub(crate) type KemPublicKey = <MlKem768 as Kem>::PubKey;
pub(crate) type KemSecretKey = <MlKem768 as Kem>::SecretKey;
pub(crate) type KemKeyPair = KeyPair<KemPublicKey, KemSecretKey>;

const PROLOGUE_DOMAIN: &[u8] = b"broski-link/v1";

/// The mode byte is part of the prologue so a message minted in one mode cannot be
/// replayed into the other: the two peers' transcripts diverge before the first token.
pub(crate) fn prologue(kind: HandshakeModeKind) -> [u8; PROLOGUE_DOMAIN.len() + 1] {
    let mut prologue = [0u8; PROLOGUE_DOMAIN.len() + 1];
    prologue[..PROLOGUE_DOMAIN.len()].copy_from_slice(PROLOGUE_DOMAIN);
    prologue[PROLOGUE_DOMAIN.len()] = kind.as_byte();
    prologue
}

/// Pair mode uses the `psk1` PSK modifier: the pairing secret is mixed into the
/// symmetric state of message 1, so a secret mismatch makes message 1 undecryptable.
pub(crate) fn pattern(kind: HandshakeModeKind) -> HandshakePattern {
    match kind {
        HandshakeModeKind::Connect => handshakepattern::noise_hybrid_ik(),
        HandshakeModeKind::Pair => handshakepattern::noise_hybrid_ik_psk1(),
    }
}

#[cfg(test)]
mod tests {
    use clatter::traits::{Cipher, Handshaker};
    use clatter::HybridHandshakeParams;

    use super::*;
    use crate::identity::StaticIdentity;

    #[test]
    fn clatter_protocol_names_are_stable() {
        assert_eq!(
            protocol_name(HandshakeModeKind::Connect),
            "Noise_hybridIK_25519+MLKEM768_AESGCM_SHA256"
        );
        assert_eq!(
            protocol_name(HandshakeModeKind::Pair),
            "Noise_hybridIKpsk1_25519+MLKEM768_AESGCM_SHA256"
        );
    }

    fn protocol_name(kind: HandshakeModeKind) -> String {
        let identity = StaticIdentity::generate().expect("identity");
        let peer = StaticIdentity::generate().expect("identity").public();
        let prologue = prologue(kind);
        let params = HybridHandshakeParams::new(pattern(kind), true)
            .with_prologue(&prologue)
            .with_s(identity.dh().clone())
            .with_s_kem(identity.kem().clone())
            .with_rs(peer.dh_public())
            .with_rs_kem(peer.kem_public());
        Handshake::new(params)
            .expect("handshake")
            .get_name()
            .to_string()
    }

    #[test]
    fn aes_gcm_tag_len_is_sixteen() {
        assert_eq!(<AesGcm as Cipher>::tag_len(), TAG_LEN);
    }
}
