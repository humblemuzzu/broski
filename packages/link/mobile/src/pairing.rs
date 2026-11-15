use std::sync::{Arc, Mutex, PoisonError};

use broski_link_session as link;
use broski_link_session::Platform;
use zeroize::Zeroizing;

use crate::error::CoreError;
use crate::identity::DeviceIdentity;
use crate::record::MachineRecord;
use crate::runtime::LinkRuntime;
use crate::session::LinkSession;

#[uniffi::remote(Enum)]
pub enum Platform {
    Ios,
    Android,
}

/// What a session announces to the machine: the name the machine lists this phone as, and its
/// platform.
#[derive(uniffi::Record)]
pub struct SessionOptions {
    pub device_name: String,
    pub platform: Platform,
}

impl From<SessionOptions> for link::SessionOptions {
    fn from(options: SessionOptions) -> link::SessionOptions {
        link::SessionOptions::new(options.device_name, options.platform)
    }
}

/// A scanned `broski://pair?v=2&…` offer. It pairs once: `pair` takes its one-time secret.
#[derive(uniffi::Object)]
pub struct PairingOffer {
    machine_id: String,
    name: String,
    expires_at: u64,
    offer: Mutex<Option<link::Offer>>,
}

#[uniffi::export]
impl PairingOffer {
    #[uniffi::constructor]
    pub fn parse(uri: String) -> Result<Arc<PairingOffer>, CoreError> {
        let uri = Zeroizing::new(uri);
        let offer = link::Offer::parse(&uri)?;
        Ok(Arc::new(PairingOffer {
            machine_id: offer.machine_id(),
            name: offer.name().to_owned(),
            expires_at: offer.expires_at(),
            offer: Mutex::new(Some(offer)),
        }))
    }

    /// The id of the machine the offer pins.
    pub fn machine_id(&self) -> String {
        self.machine_id.clone()
    }

    pub fn name(&self) -> String {
        self.name.clone()
    }

    /// Unix seconds; the offer is expired from that second on.
    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }
}

impl PairingOffer {
    fn take(&self) -> Result<link::Offer, CoreError> {
        self.offer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            .ok_or(CoreError::OfferUsed)
    }
}

/// A finished pairing. Persist `record` before reading the session's events; a later
/// `LinkEvent::RecordChanged` replaces it.
#[derive(uniffi::Record)]
pub struct PairedMachine {
    pub session: Arc<LinkSession>,
    pub record: Arc<MachineRecord>,
}

/// Verifies the machine the offer pins, pairs with it and waits for the machine to confirm. The
/// session carries on as the machine's link, so nothing reconnects after a pairing.
#[uniffi::export]
pub async fn pair(
    runtime: Arc<LinkRuntime>,
    identity: Arc<DeviceIdentity>,
    offer: Arc<PairingOffer>,
    options: SessionOptions,
) -> Result<PairedMachine, CoreError> {
    let paired = link::pair(&runtime.0, &identity.0, offer.take()?, options.into()).await?;
    Ok(PairedMachine {
        session: Arc::new(LinkSession(paired.session)),
        record: Arc::new(MachineRecord(paired.record)),
    })
}
