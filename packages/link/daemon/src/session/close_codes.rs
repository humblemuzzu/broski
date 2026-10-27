pub const NORMAL: u16 = 1000;
/// The daemon is shutting down; the phone reconnects when it is back.
pub const SHUTDOWN: u16 = 4001;
/// The phone handed the session more for the bridge than it will hold, so its view is stale.
pub const BRIDGE_OVERFLOW: u16 = 4002;
pub const REVOKED: u16 = 4003;
/// No phone attached for the whole idle limit.
pub const IDLE_EXPIRED: u16 = 4004;
/// The session's own state could not carry on, so the phone has to start a new one.
pub const SESSION_ERROR: u16 = 4005;
