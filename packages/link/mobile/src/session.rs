use std::sync::Arc;

use broski_link_session as link;
use broski_link_session::{PushPlatform, SendFailure};

use crate::error::CoreError;
use crate::events::{LinkEvent, LinkStatus};
use crate::identity::DeviceIdentity;
use crate::pairing::SessionOptions;
use crate::record::MachineRecord;
use crate::runtime::LinkRuntime;

#[uniffi::remote(Enum)]
pub enum PushPlatform {
    Apns,
    Fcm,
}

/// The link to one paired machine; an app holds one per machine, all on one `LinkRuntime`.
///
/// Every method but `next_event` returns at once and the work happens on the runtime. Releasing
/// the session stops it quietly, and the machine keeps its side for a later resume; `end` ends it
/// on the machine too.
#[derive(uniffi::Object)]
pub struct LinkSession(pub(crate) link::Session);

#[uniffi::export]
impl LinkSession {
    /// Starts dialling the machine of a stored record.
    #[uniffi::constructor]
    pub fn start(
        runtime: Arc<LinkRuntime>,
        identity: Arc<DeviceIdentity>,
        record: Arc<MachineRecord>,
        options: SessionOptions,
    ) -> Result<Arc<LinkSession>, CoreError> {
        let session =
            link::Session::start(&runtime.0, &identity.0, record.0.clone(), options.into())?;
        Ok(Arc::new(LinkSession(session)))
    }

    pub fn machine_id(&self) -> String {
        self.0.machine_id().to_owned()
    }

    pub fn status(&self) -> LinkStatus {
        self.0.status()
    }

    /// The next event, in order; `None` once the session has ended and every event was read. One
    /// reader at a time: run it in a loop in one task and cancel the task to stop. Cancelling loses
    /// no event, because the wait is a `Notify` polled right here and an event is only taken from
    /// the queue in the poll that returns it.
    pub async fn next_event(&self) -> Option<LinkEvent> {
        self.0.next_event().await.map(LinkEvent::from)
    }

    /// Queues one bridge message (a contract frame from `encode_frame`). A refusal known now is
    /// thrown; one decided later arrives as `LinkEvent::SendFailed` with `tag`.
    pub fn send_bridge(&self, frame: Vec<u8>, tag: Option<String>) -> Result<(), SendFailure> {
        self.0.send_bridge(frame, tag)
    }

    /// Asks the machine to restart its bridge.
    pub fn restart_bridge(&self) -> Result<(), SendFailure> {
        self.0.restart_bridge()
    }

    /// Has the machine seal its alerts for this push token with the record's push key; repeated on
    /// every connect until replaced.
    pub fn register_push(&self, platform: PushPlatform, token: String) {
        self.0.register_push(platform, token);
    }

    pub fn unregister_push(&self) {
        self.0.unregister_push();
    }

    /// The app went to the background.
    pub fn pause(&self) {
        self.0.pause();
    }

    pub fn resume(&self) {
        self.0.resume();
    }

    /// The phone's network changed: every route is raced again and the session resumes.
    pub fn network_changed(&self) {
        self.0.network_changed();
    }

    /// `host:port` routes the platform's browse (`NWBrowser`, `NsdManager`) found for this
    /// machine, newest first.
    pub fn lan_discovered(&self, routes: Vec<String>) {
        self.0.lan_discovered(routes);
    }

    /// Ends the session here and on the machine. Not `close`: Kotlin objects already have one, from
    /// `AutoCloseable`, which releases the object.
    pub fn end(&self) {
        self.0.close();
    }
}
