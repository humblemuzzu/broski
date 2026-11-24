//! Pairing with the machine a QR v2 offer names (`pairing_service.dart`).

use core::fmt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_core::crypto::PairingOffer;
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::bundle;
use crate::clock::unix_ms;
use crate::engine::Pairing;
use crate::error::Error;
use crate::identity::DeviceIdentity;
use crate::options::SessionOptions;
use crate::record::MachineRecord;
use crate::runtime::LinkRuntime;
use crate::session::Session;

const ID_LABEL: &[u8] = b"broski-pair-id";
const TOKEN_LABEL: &[u8] = b"broski-pair-token";

/// A scanned `broski://pair?v=2&…` offer. Its secret is wiped when it is dropped.
pub struct Offer {
    offer: PairingOffer,
}

impl Offer {
    pub fn parse(uri: &str) -> Result<Offer, Error> {
        let offer = PairingOffer::parse(uri.trim()).map_err(Error::Offer)?;
        Ok(Offer { offer })
    }

    /// The machine id the offer's fingerprint pins.
    pub fn machine_id(&self) -> String {
        self.offer.fingerprint[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The code `broski-link pair` prints beside its QR (`verification_code`).
    pub fn verification_code(&self) -> String {
        broski_link_core::crypto::verification_code(&self.offer.fingerprint)
    }

    pub fn name(&self) -> &str {
        &self.offer.name
    }

    /// Unix seconds; the offer is expired from that second on.
    pub fn expires_at(&self) -> u64 {
        self.offer.expires_at
    }

    pub fn is_expired(&self, now_secs: u64) -> bool {
        self.offer.is_expired(now_secs)
    }
}

impl fmt::Debug for Offer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.offer.fmt(f)
    }
}

/// The one-time relay device an open offer authorises. A pairing starts before the phone holds a
/// relay token, so the phone and the machine both derive these from the offer's secret
/// (`daemon/src/pairing.rs`).
#[derive(Clone, PartialEq, Eq)]
pub struct PairingCredentials {
    pub device_id: String,
    pub token: String,
}

impl PairingCredentials {
    pub fn derive(secret: &[u8; 32]) -> PairingCredentials {
        let digest = |label: &[u8]| {
            Sha256::new()
                .chain_update(label)
                .chain_update(secret)
                .finalize()
        };
        PairingCredentials {
            device_id: digest(ID_LABEL)[..16]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
            token: URL_SAFE_NO_PAD.encode(digest(TOKEN_LABEL)),
        }
    }
}

impl fmt::Debug for PairingCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PairingCredentials")
            .field("device_id", &self.device_id)
            .field("token", &"<redacted>")
            .finish()
    }
}

/// A finished pairing: the session is live and adopted, and the record is what the app persists.
/// Persist `record` before handling the session's events; a later `Event::RecordChanged` replaces
/// it.
pub struct Paired {
    pub session: Session,
    pub record: MachineRecord,
}

/// Verifies the machine the offer pins, pairs with it in Pair mode and waits for the machine to
/// confirm. The session it returns carries on as the machine's link, so nothing reconnects after a
/// pairing.
pub async fn pair(
    runtime: &LinkRuntime,
    identity: &DeviceIdentity,
    offer: Offer,
    options: SessionOptions,
) -> Result<Paired, Error> {
    if offer.is_expired(unix_ms() / 1000) {
        return Err(Error::OfferExpired);
    }
    let pairing = pair_on(runtime.clone(), identity.clone(), offer, options);
    runtime.run(pairing).await?
}

async fn pair_on(
    runtime: LinkRuntime,
    identity: DeviceIdentity,
    offer: Offer,
    options: SessionOptions,
) -> Result<Paired, Error> {
    let timings = options.timings;
    let machine_id = offer.machine_id();
    let server = bundle::fetch(&offer.offer, &machine_id, timings.identity_fetch_timeout).await?;
    let provisional = MachineRecord {
        id: machine_id,
        name: offer.offer.name.clone(),
        os: None,
        public_bundle: server.to_bytes().to_vec(),
        device_id: identity.id(),
        relay: offer.offer.relay.clone(),
        relay_token: None,
        lan: offer.offer.lan.clone(),
        push_key: Vec::new(),
        paired_at_ms: 0,
    };
    let (done, confirmed) = oneshot::channel();
    let pairing = Pairing::new(offer.offer.secret, done);
    let session = Session::spawn(
        &runtime,
        &identity,
        server,
        provisional,
        Some(pairing),
        options,
    );
    match timeout(timings.pairing_confirm, confirmed).await {
        Ok(Ok(Ok(record))) => Ok(Paired { session, record }),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err(Error::PairingRejected(
            "the session ended before the machine confirmed",
        )),
        Err(_) => Err(Error::PairingTimeout),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pairing_credentials_match_the_pinned_vector() {
        let secret: [u8; 32] = std::array::from_fn(|index| index as u8);
        let credentials = PairingCredentials::derive(&secret);
        assert_eq!(credentials.device_id, "13cf11d39c68f01194167dec02ae299b");
        assert_eq!(
            credentials.token,
            "ftJ9gRzybv0NVMqryTFwpTALY9GjGlZ6a7MD4guui98"
        );
        assert!(!format!("{credentials:?}").contains(&credentials.token));
    }
}
