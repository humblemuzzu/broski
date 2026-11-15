use std::sync::Arc;

use broski_link_session as link;
use zeroize::Zeroizing;

use crate::error::CoreError;

/// The phone's identity, one per install and shared by every paired machine. The app keeps
/// `secret()` in the Keychain or the Keystore; a stored secret that fails `from_secret` is an
/// error to surface, never a reason to generate a new identity, which would orphan every pairing.
#[derive(uniffi::Object)]
pub struct DeviceIdentity(pub(crate) link::DeviceIdentity);

#[uniffi::export]
impl DeviceIdentity {
    /// A new identity, for the first run. Persist `secret()` before pairing with it.
    #[uniffi::constructor]
    pub fn generate() -> Result<Arc<DeviceIdentity>, CoreError> {
        Ok(Arc::new(DeviceIdentity(link::DeviceIdentity::generate()?)))
    }

    #[uniffi::constructor]
    pub fn from_secret(secret: Vec<u8>) -> Result<Arc<DeviceIdentity>, CoreError> {
        let secret = Zeroizing::new(secret);
        Ok(Arc::new(DeviceIdentity(link::DeviceIdentity::from_secret(
            &secret,
        )?)))
    }

    /// The 3617-byte secret to store.
    pub fn secret(&self) -> Vec<u8> {
        self.0.secret().to_vec()
    }

    /// This phone's device id on every machine.
    pub fn id(&self) -> String {
        self.0.id()
    }
}
