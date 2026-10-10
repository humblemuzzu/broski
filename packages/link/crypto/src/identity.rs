use core::fmt;

use clatter::bytearray::{ByteArray, SensitiveByteArray};
use clatter::crypto::dh::X25519;
use clatter::crypto::kem::rust_crypto_ml_kem::MlKem768;
use clatter::traits::{Dh, Kem};
use clatter::KeyPair;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::error::{Error, Result};
use crate::suite::{
    DhKeyPair, DhPrivateKey, DhPublicKey, KemKeyPair, KemPublicKey, KemSecretKey, KEM_PUBLIC_LEN,
    KEM_SECRET_LEN, X25519_PUBLIC_LEN, X25519_SECRET_LEN,
};
use crate::uri::HEX;

const VERSION: u8 = 1;

pub const PUBLIC_BUNDLE_LEN: usize = 1 + X25519_PUBLIC_LEN + KEM_PUBLIC_LEN;
pub const SECRET_BYTES_LEN: usize = 1 + X25519_SECRET_LEN + KEM_SECRET_LEN + KEM_PUBLIC_LEN;

#[derive(Clone, PartialEq, Eq)]
pub struct PublicBundle {
    bytes: [u8; PUBLIC_BUNDLE_LEN],
}

impl PublicBundle {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != PUBLIC_BUNDLE_LEN {
            return Err(Error::Malformed("public bundle length"));
        }
        if bytes[0] != VERSION {
            return Err(Error::UnsupportedVersion(bytes[0]));
        }
        let mut bundle = [0u8; PUBLIC_BUNDLE_LEN];
        bundle.copy_from_slice(bytes);
        Ok(Self { bytes: bundle })
    }

    pub fn to_bytes(&self) -> [u8; PUBLIC_BUNDLE_LEN] {
        self.bytes
    }

    pub fn as_bytes(&self) -> &[u8; PUBLIC_BUNDLE_LEN] {
        &self.bytes
    }

    pub fn fingerprint(&self) -> [u8; 32] {
        let mut fingerprint = [0u8; 32];
        fingerprint.copy_from_slice(&Sha256::digest(self.bytes));
        fingerprint
    }

    pub fn id(&self) -> String {
        let fingerprint = self.fingerprint();
        let mut id = String::with_capacity(32);
        for byte in &fingerprint[..16] {
            id.push(HEX[(byte >> 4) as usize] as char);
            id.push(HEX[(byte & 0x0f) as usize] as char);
        }
        id
    }

    pub(crate) fn dh_public(&self) -> DhPublicKey {
        let mut key = [0u8; X25519_PUBLIC_LEN];
        key.copy_from_slice(&self.bytes[1..1 + X25519_PUBLIC_LEN]);
        key
    }

    pub(crate) fn kem_public(&self) -> KemPublicKey {
        KemPublicKey::from_slice(&self.bytes[1 + X25519_PUBLIC_LEN..])
    }

    pub(crate) fn from_parts(dh_public: &DhPublicKey, kem_public: &KemPublicKey) -> Self {
        let mut bytes = [0u8; PUBLIC_BUNDLE_LEN];
        bytes[0] = VERSION;
        bytes[1..1 + X25519_PUBLIC_LEN].copy_from_slice(dh_public.as_slice());
        bytes[1 + X25519_PUBLIC_LEN..].copy_from_slice(kem_public.as_slice());
        Self { bytes }
    }
}

impl fmt::Debug for PublicBundle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PublicBundle")
            .field("id", &self.id())
            .finish()
    }
}

pub struct StaticIdentity {
    dh: DhKeyPair,
    kem: KemKeyPair,
}

impl StaticIdentity {
    pub fn generate() -> Result<Self> {
        let dh = X25519::genkey().map_err(|_| Error::KeyGeneration)?;
        let kem = MlKem768::genkey().map_err(|_| Error::KeyGeneration)?;
        Ok(Self { dh, kem })
    }

    /// Layout is `[1][X25519 secret][ML-KEM-768 decapsulation key][ML-KEM-768 encapsulation key]`.
    /// The encapsulation key is carried along because clatter's `Kem` trait cannot derive it
    /// from a decapsulation key.
    pub fn to_secret_bytes(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(SECRET_BYTES_LEN));
        bytes.push(VERSION);
        bytes.extend_from_slice(self.dh.secret.as_slice());
        bytes.extend_from_slice(self.kem.secret.as_slice());
        bytes.extend_from_slice(self.kem.public.as_slice());
        bytes
    }

    pub fn from_secret_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != SECRET_BYTES_LEN {
            return Err(Error::Malformed("identity secret length"));
        }
        if bytes[0] != VERSION {
            return Err(Error::UnsupportedVersion(bytes[0]));
        }
        let dh_secret: DhPrivateKey =
            SensitiveByteArray::from_slice(&bytes[1..1 + X25519_SECRET_LEN]);
        let kem_start = 1 + X25519_SECRET_LEN;
        let kem_secret = KemSecretKey::from_slice(&bytes[kem_start..kem_start + KEM_SECRET_LEN]);
        let kem_public = KemPublicKey::from_slice(&bytes[kem_start + KEM_SECRET_LEN..]);
        Ok(Self {
            dh: KeyPair::new(X25519::pubkey(&dh_secret), dh_secret),
            kem: KeyPair::new(kem_public, kem_secret),
        })
    }

    pub fn public(&self) -> PublicBundle {
        PublicBundle::from_parts(&self.dh.public, &self.kem.public)
    }

    pub(crate) fn dh(&self) -> &DhKeyPair {
        &self.dh
    }

    pub(crate) fn kem(&self) -> &KemKeyPair {
        &self.kem
    }
}

impl fmt::Debug for StaticIdentity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StaticIdentity")
            .field("id", &self.public().id())
            .finish()
    }
}
