use std::sync::Arc;

use broski_link_core::crypto::PublicBundle;
use broski_link_core::{STREAM_BRIDGE, STREAM_CONTROL};
use tokio::sync::mpsc;

use crate::control::{self, PushPlatform};
use crate::engine::{Command, Engine, LiveActivityIntent, Pairing, Parts, PushIntent};
use crate::error::Error;
use crate::events::{locked, Event, Shared};
use crate::identity::DeviceIdentity;
use crate::notify::NotifyPrefs;
use crate::options::SessionOptions;
use crate::outbound::SendFailure;
use crate::record::MachineRecord;
use crate::runtime::LinkRuntime;
use crate::status::Status;

/// The link to one paired machine. Sessions are independent: an app holds one per machine, all on
/// one `LinkRuntime`.
///
/// Every method returns at once; the work happens on the runtime. Dropping the session stops it
/// quietly and the machine keeps its side for a later resume; `close` ends it on the machine too.
pub struct Session {
    shared: Arc<Shared>,
    commands: mpsc::UnboundedSender<Command>,
    machine_id: String,
    _runtime: LinkRuntime,
}

impl Session {
    /// Starts dialling the machine of a stored record.
    pub fn start(
        runtime: &LinkRuntime,
        identity: &DeviceIdentity,
        record: MachineRecord,
        options: SessionOptions,
    ) -> Result<Session, Error> {
        let server = record.validate()?;
        if record.device_id != identity.id() {
            return Err(Error::Record(
                "the record belongs to another device identity",
            ));
        }
        Ok(Session::spawn(
            runtime, identity, server, record, None, options,
        ))
    }

    pub(crate) fn spawn(
        runtime: &LinkRuntime,
        identity: &DeviceIdentity,
        server: PublicBundle,
        record: MachineRecord,
        pairing: Option<Pairing>,
        options: SessionOptions,
    ) -> Session {
        let shared = Arc::new(Shared::new());
        let (commands, receiver) = mpsc::unbounded_channel();
        let machine_id = record.id.clone();
        let engine = Engine::new(Parts {
            shared: Arc::clone(&shared),
            commands: receiver,
            identity: identity.clone(),
            server,
            record,
            pairing,
            options,
        });
        runtime.handle().spawn(engine.run());
        Session {
            shared,
            commands,
            machine_id,
            _runtime: runtime.clone(),
        }
    }

    pub fn machine_id(&self) -> &str {
        &self.machine_id
    }

    pub fn status(&self) -> Status {
        self.shared.status()
    }

    /// The next event, in order; `None` once the session has ended and every event was read.
    /// One reader at a time.
    pub async fn next_event(&self) -> Option<Event> {
        self.shared.next_event().await
    }

    /// Queues one bridge message. A refusal known now comes back now; one decided later comes as
    /// `Event::SendFailed` with `tag`.
    pub fn send_bridge(&self, frame: Vec<u8>, tag: Option<String>) -> Result<(), SendFailure> {
        self.queue(STREAM_BRIDGE, frame, tag)
    }

    /// Asks the machine to restart its bridge.
    pub fn restart_bridge(&self) -> Result<(), SendFailure> {
        self.queue(STREAM_CONTROL, control::bridge_restart(), None)
    }

    /// Has the machine seal its alerts for this push token with the record's push key; repeated on
    /// every connect until replaced.
    pub fn register_push(&self, platform: PushPlatform, token: String) {
        self.command(Command::Push(Some(PushIntent::Register {
            platform,
            token,
        })));
    }

    pub fn unregister_push(&self) {
        self.command(Command::Push(Some(PushIntent::Unregister)));
    }

    /// Tells the machine which alerts to send this phone; repeated on every connect, so a machine
    /// that restarted has it again.
    pub fn set_notify_prefs(&self, prefs: NotifyPrefs) {
        self.command(Command::Notify(prefs));
    }

    /// Registers the active iOS Live Activity push token with the machine; repeated on connect.
    pub fn register_live_activity(&self, token: String) {
        self.command(Command::LiveActivity(Some(LiveActivityIntent::Register {
            token,
        })));
    }

    pub fn unregister_live_activity(&self) {
        self.command(Command::LiveActivity(Some(LiveActivityIntent::Unregister)));
    }

    /// The app went to the background.
    pub fn pause(&self) {
        self.command(Command::Pause);
    }

    pub fn resume(&self) {
        self.command(Command::Resume);
    }

    /// The phone's network changed: every route is raced again and the session resumes.
    pub fn network_changed(&self) {
        self.command(Command::NetworkChanged);
    }

    /// `host:port` routes the platform's browse (`NWBrowser`, `NsdManager`) found for this
    /// machine, newest first.
    pub fn lan_discovered(&self, routes: Vec<String>) {
        self.command(Command::LanDiscovered(routes));
    }

    /// Ends the session here and on the machine.
    pub fn close(&self) {
        self.command(Command::Close);
    }

    fn queue(&self, stream: u32, bytes: Vec<u8>, tag: Option<String>) -> Result<(), SendFailure> {
        locked(&self.shared.outbound).push(stream, bytes, tag)?;
        self.shared.outbound_ready.notify_one();
        Ok(())
    }

    /// A command to an engine that has finished goes nowhere, which is what it asks for anyway.
    fn command(&self, command: Command) {
        let _ = self.commands.send(command);
    }
}
