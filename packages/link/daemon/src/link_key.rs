use std::path::{Path, PathBuf};

use zeroize::Zeroizing;

use crate::codec;
use crate::error::Result;
use crate::fsx;

pub const FILE: &str = "bridge.key";
/// The header every websocket upgrade to the bridge socket carries, next to the device headers.
pub const HEADER: &str = "x-broski-link-key";

const KEY_BYTES: usize = 32;

/// The secret that tells the bridge an upgrade comes from this daemon and nobody else. Minted on
/// every start, written to `<home>/bridge.key` before the bridge is spawned or dialled, and handed
/// to a supervised bridge as `--link-key-file`, so the bridge can refuse every other client on its
/// unix socket.
pub struct LinkKey {
    hex: Zeroizing<String>,
    path: PathBuf,
}

impl LinkKey {
    pub fn create(home: &Path) -> Result<LinkKey> {
        let bytes: [u8; KEY_BYTES] = crate::clock::bytes()?;
        let key = LinkKey {
            hex: Zeroizing::new(codec::hex(&bytes)),
            path: home.join(FILE),
        };
        fsx::write_atomic(&key.path, key.hex.as_bytes())?;
        Ok(key)
    }

    pub fn header(&self) -> &str {
        &self.hex
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn a_key_is_thirty_two_random_bytes_written_owner_only() {
        let dir = tempfile::tempdir().expect("temp dir");
        fsx::ensure_dir(dir.path()).expect("home");
        let first = LinkKey::create(dir.path()).expect("key");
        let mode = std::fs::metadata(first.path())
            .expect("the key file exists")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        let written = std::fs::read_to_string(first.path()).expect("read the key");
        assert_eq!(written.len(), KEY_BYTES * 2);
        assert!(written.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(written, first.header());

        let second = LinkKey::create(dir.path()).expect("second key");
        assert_ne!(first.header(), second.header(), "a start mints a new key");
        assert_eq!(
            std::fs::read_to_string(second.path()).expect("read"),
            second.header()
        );
    }
}
