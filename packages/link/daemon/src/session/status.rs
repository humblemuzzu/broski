use crate::bridge_status::{BridgeStatus, UP};
use crate::control::ToDevice;

use super::wire::encode;
use super::Actor;

const CONNECTING: &str = "connecting";

/// What one session reports about its own bridge socket. `up` means that socket is ready; the
/// process state comes from the supervisor otherwise, and `connecting` covers a bridge that
/// answers while this session's socket has not been accepted yet.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct SessionBridge {
    pub state: &'static str,
    pub conn: u64,
    pub detail: Option<String>,
}

impl SessionBridge {
    pub(super) fn of(ready: bool, conn: u64, process: &BridgeStatus) -> SessionBridge {
        let (state, detail) = if ready {
            (UP, None)
        } else if process.state == UP {
            (CONNECTING, None)
        } else {
            (process.state, process.detail.clone())
        };
        SessionBridge {
            state,
            conn,
            detail,
        }
    }
}

impl Actor {
    /// `force` is for an attach: a connection that has just arrived needs the state even unchanged.
    pub(super) fn send_bridge_status(&mut self, force: bool) {
        let next = SessionBridge::of(
            self.bridge.is_ready(),
            self.bridge.conn(),
            &self.deps.monitor.status(),
        );
        if !force && self.last_bridge.as_ref() == Some(&next) {
            return;
        }
        let message = ToDevice::Bridge {
            state: next.state,
            conn: next.conn,
            detail: next.detail.as_deref(),
        };
        if let Some(bytes) = encode(&message) {
            if self.push_control(bytes) {
                self.last_bridge = Some(next);
            }
        }
    }
}
