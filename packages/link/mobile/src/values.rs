//! The client's values, restated for UniFFI; the compiler checks each restatement against
//! `broski-client`, so they cannot drift.

use broski_client::{
    ClientError, ContractState, InboxRow, InboxState, InboxUpdate, LinkFailure, MachineEvent,
    MachineStatus, PendingAsk, PhoneConfig, SeenMarker, SeenState, SessionChange,
    SessionListUpdate, SessionUpdate, TerminalUpdate, ViewEnd,
};
use broski_contract::{
    ActiveRun, ActivityItem, BackendDescriptor, BackendExtension, BackendId, BackendStatus,
    BackgroundTask, BlockId, CatalogScope, CompactionState, ErrorEvent, Interaction, InteractionId,
    ModeSetting, ModelId, NoticeEvent, OpenBlock, ProtocolErrorCode, QueueItem, RejectionCode,
    RetryState, RunOutcome, RunningTool, SessionCapabilities, SessionRef, SessionSnapshot,
    SessionStatus, SessionSummary, ToolCallId, TranscriptItem, Usage, WorkingDirectory,
};
use broski_link_session::{BridgeStatus, Platform, SendFailure};

use crate::link::LinkStatus;

#[uniffi::remote(Record)]
pub struct PhoneConfig {
    pub device_name: String,
    pub platform: Platform,
    pub client_name: String,
    pub client_version: String,
}

#[uniffi::remote(Record)]
pub struct MachineStatus {
    pub link: LinkStatus,
    pub bridge: Option<BridgeStatus>,
    pub contract: ContractState,
}

#[uniffi::remote(Enum)]
pub enum ContractState {
    Waiting,
    Ready { bridge_version: String },
    Refused { message: String },
    Incompatible { message: String },
}

#[uniffi::remote(Enum)]
pub enum MachineEvent {
    StatusChanged {
        status: MachineStatus,
    },
    RecordChanged,
    BackendsChanged {
        backends: Vec<BackendDescriptor>,
    },
    BackendStatusChanged {
        backend: BackendId,
        status: BackendStatus,
    },
    CatalogInvalidated {
        backend: BackendId,
        scope: CatalogScope,
    },
}

#[uniffi::remote(Enum)]
pub enum SessionUpdate {
    Reset {
        session: SessionRef,
        capabilities: SessionCapabilities,
        snapshot: SessionSnapshot,
        status: SessionStatus,
    },
    Changes {
        changes: Vec<SessionChange>,
        status: SessionStatus,
    },
    Live {
        live: bool,
    },
    Ended {
        reason: ViewEnd,
    },
}

#[uniffi::remote(Enum)]
pub enum SessionChange {
    RunChanged {
        run: Option<ActiveRun>,
    },
    RunItemAppended {
        item: TranscriptItem,
    },
    RunItemReplaced {
        index: u32,
        item: TranscriptItem,
    },
    RunItemsDropped {
        count: u32,
        dropped_items: i64,
    },
    BlockOpened {
        block: OpenBlock,
    },
    BlockTextChanged {
        block_id: BlockId,
        text: String,
    },
    BlockClosed {
        block_id: BlockId,
    },
    ToolOpened {
        tool: RunningTool,
    },
    ToolChanged {
        tool: RunningTool,
    },
    ToolClosed {
        tool_call_id: ToolCallId,
    },
    InteractionAdded {
        interaction: Interaction,
    },
    InteractionRemoved {
        interaction_id: InteractionId,
    },
    QueueChanged {
        items: Vec<QueueItem>,
    },
    BackgroundTasksChanged {
        tasks: Vec<BackgroundTask>,
    },
    ModelChanged {
        model_id: Option<ModelId>,
        thinking: Option<String>,
    },
    ModesChanged {
        modes: Vec<ModeSetting>,
    },
    UsageChanged {
        usage: Option<Usage>,
    },
    CompactionChanged {
        compaction: Option<CompactionState>,
    },
    RetryChanged {
        retry: Option<RetryState>,
    },
    OutcomeChanged {
        outcome: Option<RunOutcome>,
    },
    NoticeShown {
        notice: NoticeEvent,
    },
    ActivityShown {
        item: ActivityItem,
    },
    ErrorShown {
        error: ErrorEvent,
    },
    ExtensionReceived {
        extension: BackendExtension,
    },
    InputReturned {
        texts: Vec<String>,
    },
}

#[uniffi::remote(Enum)]
pub enum ViewEnd {
    Removed,
    Refused { message: String },
    Closed,
    Revoked,
}

#[uniffi::remote(Enum)]
pub enum TerminalUpdate {
    Output {
        data: Vec<u8>,
        reset: bool,
    },
    Exited {
        exit_code: Option<i64>,
        signal: Option<String>,
    },
    Failed {
        message: String,
    },
}

#[uniffi::remote(Record)]
pub struct SessionListUpdate {
    pub rows: Vec<SessionSummary>,
    pub has_more: bool,
}

#[uniffi::remote(Enum)]
pub enum InboxState {
    NeedsYou,
    Working,
    Done,
    Idle,
}

#[uniffi::remote(Record)]
pub struct InboxRow {
    pub machine_id: String,
    pub machine_name: String,
    pub session: SessionRef,
    pub title: Option<String>,
    pub cwd: Option<WorkingDirectory>,
    pub state: InboxState,
    pub updated_at: i64,
    pub run_started_at: Option<i64>,
    pub ask: Option<String>,
    pub command: Option<String>,
    pub pending: Option<PendingAsk>,
    pub cached: bool,
}

#[uniffi::remote(Record)]
pub struct InboxUpdate {
    pub rows: Vec<InboxRow>,
    pub seen: Option<SeenState>,
    pub cache: Option<Vec<u8>>,
}

#[uniffi::remote(Record)]
pub struct SeenState {
    pub markers: Vec<SeenMarker>,
    pub read_machines: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct SeenMarker {
    pub machine_id: String,
    pub session: SessionRef,
    pub seen_at: i64,
}

#[uniffi::remote(Error)]
pub enum ClientError {
    Refused {
        code: ProtocolErrorCode,
        detail: String,
    },
    Rejected {
        code: RejectionCode,
        detail: String,
    },
    Incompatible {
        detail: String,
    },
    LinkReset,
    Timeout,
    NotSent {
        failure: SendFailure,
    },
    Overloaded,
    InvalidRequest {
        detail: String,
    },
    UnexpectedAnswer {
        answer: String,
    },
    Revoked,
    Closed,
    Link {
        failure: LinkFailure,
        detail: String,
    },
}

#[uniffi::remote(Enum)]
pub enum LinkFailure {
    Identity,
    Offer,
    OfferExpired,
    Record,
    MachineUnreachable,
    FingerprintMismatch,
    PairingRejected,
    PairingTimeout,
    Push,
    Randomness,
    Runtime,
}
