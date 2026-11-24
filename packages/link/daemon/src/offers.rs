use std::collections::{HashSet, VecDeque};
use std::sync::Arc;

use broski_link_core::crypto::{HandshakeModeKind, PairingOffer, StaticIdentity};
use broski_link_core::{Accepted, Link};
use sha2::{Digest, Sha256};
use tokio::sync::{watch, Mutex};

use crate::device::clamp_name;
use crate::error::{Error, Result};
use crate::pairing::{Pairing, PairingDevice};

pub const TTL_SECS: u64 = 600;
const SEEN_MSG1_CAP: usize = 512;

struct Active {
    secret: [u8; 32],
    expires_at: u64,
}

#[derive(Default)]
struct State {
    active: Option<Active>,
    seen_order: VecDeque<[u8; 32]>,
    seen_set: HashSet<[u8; 32]>,
}

/// One pairing offer at a time: opening a new one replaces the previous.
pub struct Offers {
    state: Mutex<State>,
    pairing: watch::Sender<Pairing>,
}

impl Offers {
    pub fn new() -> Arc<Offers> {
        let (pairing, _) = watch::channel(Pairing::None);
        Arc::new(Offers {
            state: Mutex::new(State::default()),
            pairing,
        })
    }

    /// The relay-facing pairing device; the relay client watches it and keeps the relay in step.
    pub fn pairing(&self) -> watch::Receiver<Pairing> {
        self.pairing.subscribe()
    }

    pub fn is_pairing_device(&self, device_id: &str) -> bool {
        matches!(self.pairing.borrow().clone(), Pairing::Allowed(device) if device.id == device_id)
    }

    /// The session wrote the pairing-device revoke on the machine socket, so the relay client only
    /// has to forget the device instead of revoking it again.
    pub fn pairing_revoked(&self, device_id: &str) {
        self.retire(device_id, Pairing::Retired(device_id.to_owned()));
    }

    /// The revoke never reached the relay; the relay client sends one.
    pub fn pairing_unreachable(&self, device_id: &str) {
        self.retire(device_id, Pairing::None);
    }

    fn retire(&self, device_id: &str, next: Pairing) {
        if self.is_pairing_device(device_id) {
            self.pairing.send_replace(next);
        }
    }

    pub async fn open(
        &self,
        identity: &StaticIdentity,
        name: &str,
        relay: Option<String>,
        lan: Vec<String>,
        now_secs: u64,
    ) -> Result<(String, u64)> {
        let secret: [u8; 32] = crate::clock::bytes()?;
        let expires_at = now_secs + TTL_SECS;
        let offer = PairingOffer {
            fingerprint: identity.public().fingerprint(),
            secret,
            relay,
            lan,
            name: clamp_name(name),
            expires_at,
        };
        let uri = offer.to_uri();
        self.state.lock().await.active = Some(Active { secret, expires_at });
        self.pairing
            .send_replace(Pairing::Allowed(PairingDevice::derive(&secret, expires_at)));
        Ok((uri, expires_at))
    }

    /// Answers an accepted msg1. Pair mode consumes the offer, Connect mode never
    /// reads it; the lock spans the handshake so two Pair attempts cannot both win,
    /// and recently accepted msg1 digests are rejected so a captured msg1 cannot be
    /// replayed to displace a live session.
    pub async fn accept(
        &self,
        identity: &StaticIdentity,
        msg1: &[u8],
        now_secs: u64,
    ) -> Result<Accepted> {
        let digest: [u8; 32] = Sha256::digest(msg1).into();
        let mut state = self.state.lock().await;
        if state.seen_set.contains(&digest) {
            return Err(Error::message("replayed handshake message"));
        }
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.expires_at <= now_secs)
        {
            state.active = None;
        }
        let secret = state.active.as_ref().map(|active| active.secret);
        let accepted = Link::accept(identity, msg1, || secret)?;
        if accepted.mode == HandshakeModeKind::Pair {
            state.active = None;
        }
        if state.seen_set.insert(digest) {
            state.seen_order.push_back(digest);
            if state.seen_order.len() > SEEN_MSG1_CAP {
                if let Some(old) = state.seen_order.pop_front() {
                    state.seen_set.remove(&old);
                }
            }
        }
        Ok(accepted)
    }
}

#[cfg(test)]
mod tests {
    use broski_link_core::crypto::{HandshakeMode, Initiator, StaticIdentity};
    use broski_link_core::proto::Hello;

    use super::*;

    fn msg1(device: &StaticIdentity, machine: &StaticIdentity, secret: [u8; 32]) -> Vec<u8> {
        let hello = Hello {
            resume: None,
            caps: 0,
        };
        let (_, message) = Initiator::start(
            device,
            &machine.public(),
            HandshakeMode::Pair { secret },
            &hello.encode(),
        )
        .expect("msg1");
        message
    }

    #[tokio::test]
    async fn an_offer_pairs_once_and_an_expired_one_never_pairs() {
        let machine = StaticIdentity::generate().expect("machine");
        let device = StaticIdentity::generate().expect("device");
        let offers = Offers::new();

        let (uri, expires_at) = offers
            .open(&machine, "mac", None, Vec::new(), 1_000)
            .await
            .expect("offer");
        let offer = PairingOffer::parse(&uri).expect("the offer is a valid uri");
        let message = msg1(&device, &machine, offer.secret);
        assert!(
            offers
                .accept(&machine, &message, expires_at - 1)
                .await
                .is_ok(),
            "the offer pairs one second before it expires"
        );
        assert!(
            offers
                .accept(&machine, &message, expires_at - 1)
                .await
                .is_err(),
            "the offer is consumed by that pair"
        );

        let (uri, expires_at) = offers
            .open(&machine, "mac", None, Vec::new(), 1_000)
            .await
            .expect("offer");
        let offer = PairingOffer::parse(&uri).expect("the offer is a valid uri");
        let message = msg1(&device, &machine, offer.secret);
        assert!(
            offers.accept(&machine, &message, expires_at).await.is_err(),
            "an expired offer never pairs"
        );
    }

    #[tokio::test]
    async fn a_new_offer_replaces_the_pairing_device() {
        let machine = StaticIdentity::generate().expect("machine");
        let offers = Offers::new();
        let pairing = offers.pairing();

        offers
            .open(&machine, "mac", None, Vec::new(), 1_000)
            .await
            .expect("offer");
        let first = match pairing.borrow().clone() {
            Pairing::Allowed(device) => device,
            _ => panic!("a new offer authorises a pairing device"),
        };

        offers
            .open(&machine, "mac", None, Vec::new(), 2_000)
            .await
            .expect("offer");
        let second = match pairing.borrow().clone() {
            Pairing::Allowed(device) => device,
            _ => panic!("the replacement authorises its own pairing device"),
        };
        assert_ne!(first.id, second.id);
        assert!(!offers.is_pairing_device(&first.id));
        assert!(offers.is_pairing_device(&second.id));

        offers.pairing_revoked(&second.id);
        assert!(matches!(*pairing.borrow(), Pairing::Retired(ref id) if *id == second.id));
        assert!(!offers.is_pairing_device(&second.id));
    }
}
