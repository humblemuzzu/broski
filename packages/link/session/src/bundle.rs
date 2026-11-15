//! Fetching the machine bundle a pairing offer pins (`machine_bundle_fetcher.dart`).

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_core::crypto::{PairingOffer, PublicBundle};
use serde_json::Value;
use tokio::task::JoinSet;
use tokio::time::timeout;
use url::Url;

use crate::endpoint::{lan_target, relay_http};
use crate::error::Error;
use crate::http;
use crate::tls;

/// An identity answer is a 1217-byte bundle in b64url and a few bytes of JSON.
const IDENTITY_LIMIT: usize = 4096;

/// Asks every address the offer names at once and returns the first bundle whose SHA-256 is the
/// offer's fingerprint. An address that answers with another bundle is disqualified, never used:
/// the offer is the only thing telling this phone which machine it is pairing with.
pub(crate) async fn fetch(
    offer: &PairingOffer,
    machine_id: &str,
    within: Duration,
) -> Result<PublicBundle, Error> {
    let candidates = candidates(offer, machine_id);
    if candidates.is_empty() {
        return Err(Error::MachineUnreachable);
    }
    let mut answers = JoinSet::new();
    for url in candidates {
        answers.spawn(async move {
            let body = timeout(
                within,
                http::get(&url, tls::client_config(), IDENTITY_LIMIT),
            )
            .await;
            body.ok().flatten().and_then(|body| bundle(&body))
        });
    }
    let mut mismatched = false;
    while let Some(answer) = answers.join_next().await {
        let Ok(Some(bundle)) = answer else {
            continue;
        };
        if bundle.fingerprint() == offer.fingerprint {
            return Ok(bundle);
        }
        mismatched = true;
    }
    Err(if mismatched {
        Error::FingerprintMismatch
    } else {
        Error::MachineUnreachable
    })
}

/// The daemon's `/v1/identity` on every LAN candidate, and the relay's `/v1/identity/<id>`.
fn candidates(offer: &PairingOffer, machine_id: &str) -> Vec<Url> {
    let lan = offer
        .lan
        .iter()
        .filter_map(|route| lan_target(route))
        .filter_map(|target| Url::parse(&format!("http://{}/v1/identity", target.detail)).ok());
    let relay = offer
        .relay
        .as_deref()
        .and_then(|relay| relay_http(relay, &format!("/v1/identity/{machine_id}")));
    lan.chain(relay).collect()
}

/// `{"pub":"<b64url>"}`.
fn bundle(body: &[u8]) -> Option<PublicBundle> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let bytes = URL_SAFE_NO_PAD.decode(value.get("pub")?.as_str()?).ok()?;
    PublicBundle::from_bytes(&bytes).ok()
}
