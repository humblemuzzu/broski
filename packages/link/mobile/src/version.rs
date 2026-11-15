use broski_contract::{ProtocolVersion, PROTOCOL_VERSION};

/// What an app's About screen says of the core it links.
#[derive(uniffi::Record)]
pub struct CoreVersion {
    /// This library's crate version.
    pub library: String,
    /// The backend contract's protocol the core speaks to every bridge.
    pub protocol: ProtocolVersion,
}

#[uniffi::export]
pub fn core_version() -> CoreVersion {
    CoreVersion {
        library: env!("CARGO_PKG_VERSION").to_owned(),
        protocol: PROTOCOL_VERSION,
    }
}
