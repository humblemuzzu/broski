use std::sync::Arc;

use broski_link_session as link;

use crate::error::CoreError;

/// The thread every session of the app runs on. Create one per process and hand it to every
/// pairing and session; the thread stops when the last session and the runtime itself are gone.
#[derive(uniffi::Object)]
pub struct LinkRuntime(pub(crate) link::LinkRuntime);

#[uniffi::export]
impl LinkRuntime {
    #[uniffi::constructor]
    pub fn new() -> Result<Arc<LinkRuntime>, CoreError> {
        let runtime =
            link::LinkRuntime::new().map_err(|error| CoreError::RuntimeStart(error.to_string()))?;
        Ok(Arc::new(LinkRuntime(runtime)))
    }
}
