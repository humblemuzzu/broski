use broski_client::ClientError;
use broski_link_session::Offer;
use zeroize::Zeroizing;

/// What a scanned offer says before the phone pairs with it, for the scanner to show and check: the
/// machine's name, the Mac code `broski-link pair` prints beside its QR, whether it is already
/// paired (`machine_id`), and whether the offer has expired.
#[derive(uniffi::Record)]
pub struct PairingOffer {
    pub machine_id: String,
    pub name: String,
    /// `7F3A 91C2 0E5D B846`: the pinned fingerprint's first 8 bytes, which a link cannot fake.
    pub verification_code: String,
    /// Unix seconds; the offer is expired from that second on.
    pub expires_at: u64,
}

/// Reads a scanned `broski://pair?v=2&…` without pairing; `Phone.pair` takes the same text.
#[uniffi::export]
pub fn parse_pairing_offer(uri: String) -> Result<PairingOffer, ClientError> {
    let uri = Zeroizing::new(uri);
    let offer = Offer::parse(&uri)?;
    Ok(PairingOffer {
        machine_id: offer.machine_id(),
        name: offer.name().to_owned(),
        verification_code: offer.verification_code(),
        expires_at: offer.expires_at(),
    })
}
