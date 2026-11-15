use std::sync::{Arc, OnceLock};

use rustls::crypto::ring;
use rustls::{ClientConfig, RootCertStore};

/// The TLS config every `wss://` and `https://` connection uses: rustls on the ring provider with
/// Mozilla's roots compiled in. ring builds for iOS and Android with nothing but the target's C
/// toolchain, and the compiled-in roots need no platform trust store.
pub(crate) fn client_config() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            with_roots(RootCertStore {
                roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
            })
        })
        .clone()
}

/// The provider is named explicitly rather than taken from the process default, which is
/// ambiguous whenever another crate in the binary enables a second rustls provider.
pub(crate) fn with_roots(roots: RootCertStore) -> Arc<ClientConfig> {
    let config = ClientConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("the ring provider supports rustls's default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    Arc::new(config)
}
