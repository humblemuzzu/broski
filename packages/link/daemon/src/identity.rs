use std::path::Path;

use broski_link_core::crypto::StaticIdentity;

use crate::error::{Error, Result};
use crate::fsx;

const FILE: &str = "identity";

pub fn load(home: &Path) -> Result<StaticIdentity> {
    let path = home.join(FILE);
    if let Some(bytes) = fsx::read(&path)? {
        return StaticIdentity::from_secret_bytes(&bytes)
            .map_err(|error| Error::message(format!("{}: {error}", path.display())));
    }
    let identity = StaticIdentity::generate().map_err(|error| Error::message(error.to_string()))?;
    fsx::write_private(&path, &identity.to_secret_bytes())?;
    Ok(identity)
}
