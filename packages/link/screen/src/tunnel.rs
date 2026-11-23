//! Shared binary framing for the `STREAM_SCREEN` loopback tunnel between phone and daemon.

pub const DEFAULT_SCREEN_PORT: u16 = 5900;
/// Bounded per-message chunk so screen bytes never starve `STREAM_BRIDGE` or exceed relay caps.
pub const MAX_TUNNEL_CHUNK: usize = 32 * 1024;

const TAG_OPEN: u8 = 0x01;
const TAG_CLIENT_DATA: u8 = 0x02;
const TAG_CLIENT_CLOSE: u8 = 0x03;

const TAG_OPENED: u8 = 0x11;
const TAG_SERVER_DATA: u8 = 0x12;
const TAG_SERVER_CLOSED: u8 = 0x13;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ScreenCloseReason {
    Normal = 0,
    ScreenSharingDisabled = 1,
    Unavailable = 2,
    AuthFailed = 3,
    ProtocolError = 4,
    LinkReset = 5,
}

impl ScreenCloseReason {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Normal,
            1 => Self::ScreenSharingDisabled,
            2 => Self::Unavailable,
            3 => Self::AuthFailed,
            4 => Self::ProtocolError,
            5 => Self::LinkReset,
            _ => Self::Unavailable,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientTunnelMsg {
    Open { session_id: u32 },
    Data { session_id: u32, payload: Vec<u8> },
    Close { session_id: u32 },
}

impl ClientTunnelMsg {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Open { session_id } => {
                let mut out = Vec::with_capacity(5);
                out.push(TAG_OPEN);
                out.extend_from_slice(&session_id.to_be_bytes());
                out
            }
            Self::Data {
                session_id,
                payload,
            } => {
                let mut out = Vec::with_capacity(5 + payload.len());
                out.push(TAG_CLIENT_DATA);
                out.extend_from_slice(&session_id.to_be_bytes());
                out.extend_from_slice(payload);
                out
            }
            Self::Close { session_id } => {
                let mut out = Vec::with_capacity(5);
                out.push(TAG_CLIENT_CLOSE);
                out.extend_from_slice(&session_id.to_be_bytes());
                out
            }
        }
    }

    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 5 {
            return None;
        }
        let session_id = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
        match bytes[0] {
            TAG_OPEN if bytes.len() == 5 => Some(Self::Open { session_id }),
            TAG_CLIENT_DATA => Some(Self::Data {
                session_id,
                payload: bytes[5..].to_vec(),
            }),
            TAG_CLIENT_CLOSE if bytes.len() == 5 => Some(Self::Close { session_id }),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerTunnelMsg {
    Opened {
        session_id: u32,
    },
    Data {
        session_id: u32,
        payload: Vec<u8>,
    },
    Closed {
        session_id: u32,
        reason: ScreenCloseReason,
        detail: String,
    },
}

impl ServerTunnelMsg {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Opened { session_id } => {
                let mut out = Vec::with_capacity(5);
                out.push(TAG_OPENED);
                out.extend_from_slice(&session_id.to_be_bytes());
                out
            }
            Self::Data {
                session_id,
                payload,
            } => {
                let mut out = Vec::with_capacity(5 + payload.len());
                out.push(TAG_SERVER_DATA);
                out.extend_from_slice(&session_id.to_be_bytes());
                out.extend_from_slice(payload);
                out
            }
            Self::Closed {
                session_id,
                reason,
                detail,
            } => {
                let clipped = detail.as_bytes();
                let take = clipped.len().min(512);
                let mut out = Vec::with_capacity(6 + take);
                out.push(TAG_SERVER_CLOSED);
                out.extend_from_slice(&session_id.to_be_bytes());
                out.push(*reason as u8);
                out.extend_from_slice(&clipped[..take]);
                out
            }
        }
    }

    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 5 {
            return None;
        }
        let session_id = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
        match bytes[0] {
            TAG_OPENED if bytes.len() == 5 => Some(Self::Opened { session_id }),
            TAG_SERVER_DATA => Some(Self::Data {
                session_id,
                payload: bytes[5..].to_vec(),
            }),
            TAG_SERVER_CLOSED if bytes.len() >= 6 => Some(Self::Closed {
                session_id,
                reason: ScreenCloseReason::from_u8(bytes[5]),
                detail: String::from_utf8_lossy(&bytes[6..]).into_owned(),
            }),
            _ => None,
        }
    }
}
