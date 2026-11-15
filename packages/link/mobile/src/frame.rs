use broski_contract::{ClientMessage, ServerMessage};

use crate::error::CoreError;

/// The bytes `LinkSession::send_bridge` carries for one contract message.
#[uniffi::export]
pub fn encode_frame(message: ClientMessage) -> Vec<u8> {
    broski_contract::encode_frame(&message).into_bytes()
}

/// The contract message in the bytes of one `LinkEvent::Bridge`.
#[uniffi::export]
pub fn decode_frame(frame: Vec<u8>) -> Result<ServerMessage, CoreError> {
    let text = String::from_utf8(frame)
        .map_err(|_| CoreError::Frame("the bridge frame is not UTF-8".to_owned()))?;
    broski_contract::decode_frame(&text).map_err(|error| CoreError::Frame(error.to_string()))
}
