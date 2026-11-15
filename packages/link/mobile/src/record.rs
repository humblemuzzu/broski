use std::sync::Arc;

use broski_client::ClientError;
use broski_link_session as link;

/// One paired machine. Opaque because it carries the relay token and the push key: the app stores
/// `to_bytes()` whole in the Keychain or the Keystore, reads it back with `from_bytes`, and sees
/// only the fields it shows.
#[derive(uniffi::Object)]
pub struct MachineRecord(pub(crate) link::MachineRecord);

#[uniffi::export]
impl MachineRecord {
    #[uniffi::constructor]
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Arc<MachineRecord>, ClientError> {
        Ok(Arc::new(MachineRecord(link::MachineRecord::from_bytes(
            &bytes,
        )?)))
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        self.0.to_bytes()
    }

    /// The machine id: what the app keys the stored record and the machine's sessions by.
    pub fn id(&self) -> String {
        self.0.id.clone()
    }

    pub fn name(&self) -> String {
        self.0.name.clone()
    }

    pub fn os(&self) -> Option<String> {
        self.0.os.clone()
    }

    pub fn paired_at_ms(&self) -> u64 {
        self.0.paired_at_ms
    }
}
