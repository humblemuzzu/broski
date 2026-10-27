use std::time::Duration;

use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::device::DeviceRecord;
use crate::session::SessionCommand;

use super::{Decision, Deps};

const POST: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Delivery {
    Live,
    Pipe,
    Failed,
}

impl Delivery {
    pub fn as_str(self) -> &'static str {
        match self {
            Delivery::Live => "live bridge",
            Delivery::Pipe => "letter pipe",
            Delivery::Failed => "no bridge",
        }
    }
}

/// Hands one lock-screen decision to the bridge feed and waits for its result.
pub async fn decision(
    deps: &Deps,
    backend: &str,
    session: &str,
    request: Option<&Value>,
    decision: Decision,
) -> Option<Value> {
    let message = serde_json::json!({
        "type": "link_decision",
        "backend": backend,
        "session": session,
        "request": request.cloned().unwrap_or(Value::Null),
        "decision": decision.as_str(),
    });
    deps.feed.send(message, deps.durations.letter_wait).await
}

/// Delivers a bridge-kind letter on the device's bridge websocket: the session's own one when it
/// is there, otherwise the one pipe that device keeps for letters.
pub async fn bridge(deps: &Deps, device: &DeviceRecord, message: &str) -> Delivery {
    if live(deps, device, message).await {
        return Delivery::Live;
    }
    if deps.pipes.send(device, message).await {
        return Delivery::Pipe;
    }
    Delivery::Failed
}

async fn live(deps: &Deps, device: &DeviceRecord, message: &str) -> bool {
    let Some(commands) = deps.registry.commands(&device.id) else {
        return false;
    };
    let (reply, answer) = oneshot::channel();
    let command = SessionCommand::BridgeLetter {
        bytes: message.as_bytes().to_vec(),
        reply,
    };
    if commands.try_send(command).is_err() {
        return false;
    }
    matches!(timeout(POST, answer).await, Ok(Ok(true)))
}
