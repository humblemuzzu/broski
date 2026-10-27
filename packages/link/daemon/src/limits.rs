use broski_link_core::CONFIG;

/// The session stops reading its bridge socket at this much unacked, so the link keeps half its
/// window free for control messages.
pub(crate) const BRIDGE_READ_HIGH: usize = CONFIG.max_unacked_bytes / 2;

/// ... and starts again once acks bring the window back down to here.
pub(crate) const BRIDGE_READ_LOW: usize = CONFIG.max_unacked_bytes / 4;

/// One bridge message has to fit the read gate on its own: a message the bridge accepts can then
/// always be handed to the link, never refused for being larger than the window it must fit.
pub(crate) const LINK_MAX_MESSAGE_BYTES: usize = BRIDGE_READ_HIGH;

/// What a session holds for a bridge that is down before it ends the session with 4002.
pub(crate) const BRIDGE_PENDING_BYTES: usize = CONFIG.max_unacked_bytes;
