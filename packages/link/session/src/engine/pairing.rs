//! The engine's side of a first pairing (`pairing_service.dart`, `machines_provider.dart`
//! `applyPaired`).

use tokio::sync::oneshot;
use tracing::debug;
use zeroize::Zeroizing;

use super::Engine;
use crate::control::Paired;
use crate::error::Error;
use crate::pairing::PairingCredentials;
use crate::push;
use crate::record::{merge_lan_routes, MachineRecord};

/// A pairing in progress: the offer's one-time secret until a handshake completes, the relay
/// device the offer authorises until the machine sends `paired`, and who waits for the record.
pub(crate) struct Pairing {
    pub(crate) secret: Option<Zeroizing<[u8; 32]>>,
    pub(crate) relay: PairingCredentials,
    done: oneshot::Sender<Result<MachineRecord, Error>>,
}

impl Pairing {
    pub(crate) fn new(
        secret: [u8; 32],
        done: oneshot::Sender<Result<MachineRecord, Error>>,
    ) -> Pairing {
        Pairing {
            relay: PairingCredentials::derive(&secret),
            secret: Some(Zeroizing::new(secret)),
            done,
        }
    }

    pub(crate) fn fail(self, error: Error) {
        let _ = self.done.send(Err(error));
    }
}

impl Engine {
    /// The machine stored this phone. The record is built only for the machine the offer pinned,
    /// and from here on the relay is dialled with this device's own credentials.
    pub(super) fn on_paired(&mut self, paired: Paired) {
        let Some(pairing) = self.pairing.take() else {
            debug!("paired outside a pairing");
            return;
        };
        match self.paired_record(paired) {
            Ok(record) => {
                self.record = record.clone();
                let _ = pairing.done.send(Ok(record));
            }
            Err(error) => {
                pairing.fail(error);
                self.finish(crate::status::LinkState::Closed);
            }
        }
    }

    fn paired_record(&self, paired: Paired) -> Result<MachineRecord, Error> {
        if paired.machine_id != self.record.id {
            return Err(Error::PairingRejected(
                "the machine is not the one the offer pins",
            ));
        }
        if paired.device_id != self.identity.id() {
            return Err(Error::PairingRejected(
                "the machine paired another device id",
            ));
        }
        Ok(MachineRecord {
            id: paired.machine_id,
            name: paired.name,
            os: paired.os,
            public_bundle: self.server.to_bytes().to_vec(),
            device_id: paired.device_id,
            relay: paired.routes.relay,
            relay_token: Some(paired.relay_token),
            // The offer's routes stay as history: the address this phone reached the machine on
            // is worth dialling again even when the machine does not list it.
            lan: merge_lan_routes(&paired.routes.lan, &self.record.lan),
            push_key: push::generate_key()?.to_vec(),
            paired_at_ms: crate::clock::unix_ms(),
        })
    }
}
