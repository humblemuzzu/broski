use crate::codec;

const ID_LABEL: &[u8] = b"broski-pair-id";
const TOKEN_LABEL: &[u8] = b"broski-pair-token";

/// The one-time relay device an open offer authorises. It is derived from the offer secret so the
/// phone can compute the same credentials before it holds a relay token of its own.
pub fn device_id(secret: &[u8; 32]) -> String {
    codec::hex(&codec::sha256(&[ID_LABEL, secret.as_slice()].concat())[..16])
}

pub fn token(secret: &[u8; 32]) -> String {
    codec::b64url(&codec::sha256(&[TOKEN_LABEL, secret.as_slice()].concat()))
}

#[derive(Clone)]
pub struct PairingDevice {
    pub id: String,
    pub token_hash: String,
    pub expires_at: u64,
}

impl PairingDevice {
    pub fn derive(secret: &[u8; 32], expires_at: u64) -> PairingDevice {
        let token = token(secret);
        PairingDevice {
            id: device_id(secret),
            token_hash: codec::token_hash(&token),
            expires_at,
        }
    }

    pub fn expired(&self, now_secs: u64) -> bool {
        self.expires_at <= now_secs
    }
}

/// What the relay should hold for the offer: the derived device while one is open, nothing once it
/// is gone, and `Retired` when the session already wrote the revoke on the machine socket.
#[derive(Clone, Default)]
pub enum Pairing {
    #[default]
    None,
    Allowed(PairingDevice),
    Retired(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: [u8; 32] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
        0x1e, 0x1f,
    ];
    const ID: &str = "13cf11d39c68f01194167dec02ae299b";
    const TOKEN: &str = "ftJ9gRzybv0NVMqryTFwpTALY9GjGlZ6a7MD4guui98";
    const TOKEN_HASH: &str = "a3c01756f2877fbbbb15b876175a6729bdd60a7d7acba5b428fc3e8ccc24af09";

    #[test]
    fn the_derived_credentials_are_pinned() {
        assert_eq!(device_id(&SECRET), ID);
        assert_eq!(token(&SECRET), TOKEN);
        assert_eq!(PairingDevice::derive(&SECRET, 1_000).token_hash, TOKEN_HASH);
    }

    #[test]
    fn a_pairing_device_expires_at_its_second() {
        let device = PairingDevice::derive(&SECRET, 1_000);
        assert!(!device.expired(999));
        assert!(device.expired(1_000));
    }
}
