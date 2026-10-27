use std::path::Path;

use broski_link_core::crypto::StaticIdentity;
use zeroize::Zeroizing;

use crate::error::Result;
use crate::fsx;

const FILE: &str = "identity";

/// Loads the machine identity, generating it on first run only. A file that exists but cannot be
/// read is fatal: regenerating it would unpair every device, so the daemon says which file to fix.
pub fn load(home: &Path) -> Result<StaticIdentity> {
    let path = home.join(FILE);
    if let Some(bytes) = fsx::read(&path)? {
        let bytes = Zeroizing::new(bytes);
        return StaticIdentity::from_secret_bytes(&bytes)
            .map_err(|error| fsx::corrupted_identity(&path, error));
    }
    let identity =
        StaticIdentity::generate().map_err(|error| crate::Error::message(error.to_string()))?;
    let secret = Zeroizing::new(identity.to_secret_bytes());
    fsx::write_atomic(&path, &secret)?;
    Ok(identity)
}
