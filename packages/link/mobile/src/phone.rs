use std::sync::Arc;

use broski_client as client;
use broski_client::{ClientError, PhoneConfig};

use crate::inbox::Inbox;
use crate::machine::Machine;
use crate::record::MachineRecord;

/// The app's one client: create one per process, at launch, with the stored identity secret. It runs
/// every machine on one background thread of its own.
#[derive(uniffi::Object)]
pub struct Phone(client::Phone);

#[uniffi::export]
impl Phone {
    #[uniffi::constructor]
    pub fn new(identity_secret: Vec<u8>, config: PhoneConfig) -> Result<Arc<Phone>, ClientError> {
        Ok(Arc::new(Phone(client::Phone::new(
            identity_secret,
            config,
        )?)))
    }

    /// This phone's device id on every machine.
    pub fn device_id(&self) -> String {
        self.0.device_id()
    }

    /// Starts a stored machine; one already started is returned as it is.
    pub fn start(&self, record: Arc<MachineRecord>) -> Result<Arc<Machine>, ClientError> {
        self.0.start(record.0.clone()).map(Machine::wrap)
    }

    /// Pairs with the machine a scanned `broski://pair?v=2&…` names. Persist its `record()` before
    /// anything else; a machine paired again replaces the one started before.
    pub async fn pair(&self, offer: String) -> Result<Arc<Machine>, ClientError> {
        self.0.pair(offer).await.map(Machine::wrap)
    }

    pub fn machine(&self, id: String) -> Option<Arc<Machine>> {
        self.0.machine(id).map(Machine::wrap)
    }

    pub fn all_machines(&self) -> Vec<Arc<Machine>> {
        self.0
            .all_machines()
            .into_iter()
            .map(Machine::wrap)
            .collect()
    }

    /// Unpairs: ends the machine's link session here and on the machine, and drops its seen
    /// markers. The app deletes its stored record.
    pub fn forget(&self, id: String) {
        self.0.forget(id);
    }

    pub fn inbox(&self) -> Arc<Inbox> {
        Arc::new(Inbox(self.0.inbox()))
    }

    /// The app went to the background: every machine closes its socket and waits.
    pub fn pause(&self) {
        self.0.pause();
    }

    pub fn resume(&self) {
        self.0.resume();
    }

    /// The phone's network changed: every machine races its routes again.
    pub fn network_changed(&self) {
        self.0.network_changed();
    }
}

/// A new identity secret for the app's first run: persist it before creating the `Phone`. A stored
/// secret that no longer decodes is an error to surface, never a reason to make another, which would
/// orphan every paired machine.
#[uniffi::export]
pub fn new_identity_secret() -> Result<Vec<u8>, ClientError> {
    client::new_identity_secret()
}
