use std::sync::Arc;

use broski_link_core::crypto::StaticIdentity;
use zeroize::Zeroizing;

use crate::error::Error;

/// The phone's static identity: one per install, shared by every machine it pairs with. The app
/// keeps the secret in the Keychain or the Keystore and hands it in; a secret that does not decode
/// is an error, never a reason to generate a new one, which would orphan every paired machine.
#[derive(Clone)]
pub struct DeviceIdentity {
    identity: Arc<StaticIdentity>,
}

impl DeviceIdentity {
    /// A new identity, for the first run. Persist `secret()` before pairing with it.
    pub fn generate() -> Result<DeviceIdentity, Error> {
        let identity = StaticIdentity::generate().map_err(Error::Identity)?;
        Ok(DeviceIdentity {
            identity: Arc::new(identity),
        })
    }

    pub fn from_secret(secret: &[u8]) -> Result<DeviceIdentity, Error> {
        let identity = StaticIdentity::from_secret_bytes(secret).map_err(Error::Identity)?;
        Ok(DeviceIdentity {
            identity: Arc::new(identity),
        })
    }

    /// The 3617-byte secret to store; wiped when dropped.
    pub fn secret(&self) -> Zeroizing<Vec<u8>> {
        self.identity.to_secret_bytes()
    }

    /// This phone's device id on every machine: lowercase hex of 16 bytes of its bundle's SHA-256.
    pub fn id(&self) -> String {
        self.identity.public().id()
    }

    pub fn public_bundle(&self) -> Vec<u8> {
        self.identity.public().to_bytes().to_vec()
    }

    pub(crate) fn as_static(&self) -> &StaticIdentity {
        &self.identity
    }
}

impl core::fmt::Debug for DeviceIdentity {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("DeviceIdentity")
            .field("id", &self.id())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stored_secret_restores_the_same_identity_and_a_broken_one_is_refused() {
        let identity = DeviceIdentity::generate().expect("identity");
        let restored = DeviceIdentity::from_secret(&identity.secret()).expect("restored");
        assert_eq!(restored.id(), identity.id());
        assert_eq!(restored.public_bundle(), identity.public_bundle());
        assert!(matches!(
            DeviceIdentity::from_secret(&identity.secret()[1..]),
            Err(Error::Identity(_))
        ));
    }
}
