use crate::cursor::Cursor;
use crate::error::Error;

pub const HEADER_LEN: usize = 22;
pub const FLAG_MORE: u8 = 0x01;
pub const FLAG_DEFLATE: u8 = 0x02;
pub(crate) const CLOSE_PAYLOAD_LEN: usize = 2;

const FLAGS_KNOWN: u8 = FLAG_MORE | FLAG_DEFLATE;
const ACK_RANGE: std::ops::Range<usize> = HEADER_LEN - 8..HEADER_LEN;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Data = 1,
    Ack = 2,
    Ping = 3,
    Pong = 4,
    Close = 5,
}

impl Kind {
    pub fn from_u8(byte: u8) -> Result<Self, Error> {
        match byte {
            1 => Ok(Self::Data),
            2 => Ok(Self::Ack),
            3 => Ok(Self::Ping),
            4 => Ok(Self::Pong),
            5 => Ok(Self::Close),
            other => Err(Error::UnknownKind(other)),
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame<'a> {
    pub kind: Kind,
    pub flags: u8,
    pub stream: u32,
    pub seq: u64,
    pub ack: u64,
    pub payload: &'a [u8],
}

impl<'a> Frame<'a> {
    /// A frame with no stream or seq of its own: ACK, PING, PONG, CLOSE.
    pub fn control(kind: Kind, ack: u64, payload: &'a [u8]) -> Self {
        Self {
            kind,
            flags: 0,
            stream: 0,
            seq: 0,
            ack,
            payload,
        }
    }

    pub fn decode(bytes: &[u8], max_frame: usize) -> Result<Frame<'_>, Error> {
        if bytes.len() < HEADER_LEN {
            return Err(Error::Truncated {
                what: "frame header",
            });
        }
        if bytes.len() > max_frame {
            return Err(Error::FrameTooLarge {
                len: bytes.len(),
                max: max_frame,
            });
        }
        let mut cursor = Cursor::new(bytes);
        let kind = Kind::from_u8(cursor.u8("frame header")?)?;
        let flags = cursor.u8("frame header")?;
        if flags & !FLAGS_KNOWN != 0 {
            return Err(Error::ReservedFlags(flags));
        }
        let stream = cursor.u32("frame header")?;
        let seq = cursor.u64("frame header")?;
        let ack = cursor.u64("frame header")?;
        let payload = cursor.rest();
        if kind == Kind::Close && payload.len() != CLOSE_PAYLOAD_LEN {
            return Err(Error::ClosePayload(payload.len()));
        }
        Ok(Frame {
            kind,
            flags,
            stream,
            seq,
            ack,
            payload,
        })
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER_LEN + self.payload.len());
        out.push(self.kind.as_u8());
        out.push(self.flags);
        out.extend_from_slice(&self.stream.to_be_bytes());
        out.extend_from_slice(&self.seq.to_be_bytes());
        out.extend_from_slice(&self.ack.to_be_bytes());
        out.extend_from_slice(self.payload);
        out
    }
}

pub(crate) fn patch_ack(frame: &mut [u8], ack: u64) {
    if let Some(slot) = frame.get_mut(ACK_RANGE) {
        slot.copy_from_slice(&ack.to_be_bytes());
    }
}
