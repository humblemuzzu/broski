//! The app's one client: its link runtime, its identity, and every machine it is paired with.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use broski_contract::ClientInfo;
use broski_link_session::{
    pair, DeviceIdentity, LinkRuntime, MachineRecord, Offer, Platform, Session, SessionOptions,
    Timings,
};

use zeroize::Zeroizing;

use crate::error::{ClientError, LinkFailure};
use crate::inbox::Inbox;
use crate::machine::Machine;

/// What this phone says about itself: to the daemon (`device_name`, `platform`) and in the
/// contract's `hello` (`client_name`, `client_version`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhoneConfig {
    pub device_name: String,
    pub platform: Platform,
    pub client_name: String,
    pub client_version: String,
}

/// A new identity secret for the app's first run: persist it before pairing with it. A stored
/// secret that no longer decodes is an error, never a reason to make another, which would orphan
/// every paired machine.
pub fn new_identity_secret() -> Result<Vec<u8>, ClientError> {
    Ok(DeviceIdentity::generate()?.secret().to_vec())
}

pub struct Phone {
    runtime: LinkRuntime,
    identity: DeviceIdentity,
    options: SessionOptions,
    client: ClientInfo,
    machines: Mutex<Vec<Arc<Machine>>>,
    inbox: Arc<Inbox>,
}

impl Phone {
    pub fn new(identity_secret: Vec<u8>, config: PhoneConfig) -> Result<Phone, ClientError> {
        Phone::with_timings(identity_secret, config, Timings::default())
    }

    /// With the link's windows other than the production ones; tests shrink them.
    pub fn with_timings(
        identity_secret: Vec<u8>,
        config: PhoneConfig,
        timings: Timings,
    ) -> Result<Phone, ClientError> {
        let identity = DeviceIdentity::from_secret(&Zeroizing::new(identity_secret))?;
        let runtime = LinkRuntime::new().map_err(|error| ClientError::Link {
            failure: LinkFailure::Runtime,
            detail: format!("the link runtime did not start: {error}"),
        })?;
        let inbox = Arc::new(Inbox::new(runtime.clone()));
        Ok(Phone {
            options: SessionOptions {
                device_name: config.device_name,
                platform: config.platform,
                timings,
            },
            client: ClientInfo {
                name: config.client_name,
                version: config.client_version,
            },
            runtime,
            identity,
            machines: Mutex::new(Vec::new()),
            inbox,
        })
    }

    /// This phone's device id on every machine.
    pub fn device_id(&self) -> String {
        self.identity.id()
    }

    /// Starts a stored machine; one already started is returned as it is.
    pub fn start(&self, record: MachineRecord) -> Result<Arc<Machine>, ClientError> {
        let mut machines = self.machines();
        if let Some(machine) = machines.iter().find(|machine| machine.id() == record.id) {
            return Ok(Arc::clone(machine));
        }
        let options = self.options.clone();
        let session = Session::start(&self.runtime, &self.identity, record.clone(), options)?;
        let machine = self.spawn(session, record);
        machines.push(Arc::clone(&machine));
        drop(machines);
        self.inbox.add(Arc::clone(&machine));
        Ok(machine)
    }

    /// Pairs with the machine a scanned `broski://pair?v=2&…` names; persist its `record()` before
    /// anything else. A machine paired again takes the place of the one started before, and keeps
    /// its seen markers.
    pub async fn pair(&self, offer: String) -> Result<Arc<Machine>, ClientError> {
        let offer = Offer::parse(&Zeroizing::new(offer))?;
        let paired = pair(&self.runtime, &self.identity, offer, self.options.clone()).await?;
        let id = paired.record.id.clone();
        let machine = self.spawn(paired.session, paired.record);
        let mut machines = self.machines();
        let previous = machines
            .iter()
            .position(|known| known.id() == id)
            .map(|index| machines.remove(index));
        machines.push(Arc::clone(&machine));
        drop(machines);
        if let Some(previous) = previous {
            previous.retire();
        }
        self.inbox.add(Arc::clone(&machine));
        Ok(machine)
    }

    fn spawn(&self, session: Session, record: MachineRecord) -> Arc<Machine> {
        Machine::spawn(
            &self.runtime,
            session,
            record,
            self.client.clone(),
            self.inbox.notify(),
        )
    }

    pub fn machine(&self, id: String) -> Option<Arc<Machine>> {
        self.machines()
            .iter()
            .find(|machine| machine.id() == id)
            .cloned()
    }

    pub fn all_machines(&self) -> Vec<Arc<Machine>> {
        self.machines().clone()
    }

    /// Ends the machine's link session here and on the machine, and drops it and its seen markers.
    /// The app deletes its record.
    pub fn forget(&self, id: String) {
        if let Some(machine) = self.take(&id) {
            machine.close();
        }
    }

    fn take(&self, id: &str) -> Option<Arc<Machine>> {
        let mut machines = self.machines();
        let index = machines.iter().position(|machine| machine.id() == id)?;
        let machine = machines.remove(index);
        drop(machines);
        self.inbox.remove(id);
        Some(machine)
    }

    pub fn inbox(&self) -> Arc<Inbox> {
        Arc::clone(&self.inbox)
    }

    /// The app went to the background: every machine closes its socket and waits.
    pub fn pause(&self) {
        self.machines().iter().for_each(|machine| machine.pause());
    }

    pub fn resume(&self) {
        self.machines().iter().for_each(|machine| machine.resume());
    }

    /// The phone's network changed: every machine races its routes again.
    pub fn network_changed(&self) {
        self.machines()
            .iter()
            .for_each(|machine| machine.network_changed());
    }

    fn machines(&self) -> MutexGuard<'_, Vec<Arc<Machine>>> {
        self.machines.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
