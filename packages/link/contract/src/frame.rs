use serde::{Deserialize, Serialize};

use crate::{ClientMessage, ServerMessage};

/// What travels on the link: `{"type":"contract","message":…}`, both ways (`core/frame.ts`).
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Frame<M> {
    r#type: FrameType,
    message: M,
}

#[derive(Serialize, Deserialize)]
enum FrameType {
    #[serde(rename = "contract")]
    Contract,
}

#[derive(Debug, thiserror::Error)]
#[error("not a contract frame: {0}")]
pub struct FrameError(#[from] serde_json::Error);

/// The frame the bridge core reads; it begins as every frame the core writes does.
pub fn encode_frame(message: &ClientMessage) -> String {
    let frame = Frame {
        r#type: FrameType::Contract,
        message,
    };
    serde_json::to_string(&frame).expect("every map key in the contract is a string")
}

pub fn decode_frame(text: &str) -> Result<ServerMessage, FrameError> {
    let frame: Frame<ServerMessage> = serde_json::from_str(text)?;
    Ok(frame.message)
}
