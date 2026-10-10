use crate::cursor::Cursor;
use crate::error::Error;

pub const PROTOCOL_VERSION: u8 = 1;

const FLAG_RESUME: u8 = 0x01;
const HELLO_BASE_LEN: usize = 6;
const RESUME_LEN: usize = 24;
const WELCOME_LEN: usize = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Resume {
    pub session_id: [u8; 16],
    pub next_expected: u64,
}

/// Sent inside Noise msg1; carries the resume offer for a dropped connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hello {
    pub resume: Option<Resume>,
    pub caps: u32,
}

/// Sent inside Noise msg2; answers with the session id and the responder's own
/// receive frontier, so the initiator can retransmit whatever the responder missed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Welcome {
    pub session_id: [u8; 16],
    pub resumed: bool,
    pub next_expected: u64,
    pub caps: u32,
}

impl Hello {
    pub fn encode(&self) -> Vec<u8> {
        let resume = self.resume.is_some();
        let mut out = Vec::with_capacity(HELLO_BASE_LEN + if resume { RESUME_LEN } else { 0 });
        out.push(PROTOCOL_VERSION);
        out.push(if resume { FLAG_RESUME } else { 0 });
        out.extend_from_slice(&self.caps.to_be_bytes());
        if let Some(resume) = &self.resume {
            out.extend_from_slice(&resume.session_id);
            out.extend_from_slice(&resume.next_expected.to_be_bytes());
        }
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Hello, Error> {
        let mut cursor = Cursor::new(bytes);
        check_version(cursor.u8("Hello")?)?;
        let flags = cursor.u8("Hello")?;
        if flags & !FLAG_RESUME != 0 {
            return Err(Error::ReservedFlags(flags));
        }
        let caps = cursor.u32("Hello")?;
        let resume = if flags & FLAG_RESUME != 0 {
            let session_id = cursor.array("Hello")?;
            let next_expected = cursor.u64("Hello")?;
            Some(Resume {
                session_id,
                next_expected,
            })
        } else {
            None
        };
        cursor.finish("Hello")?;
        Ok(Hello { resume, caps })
    }
}

impl Welcome {
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(WELCOME_LEN);
        out.push(PROTOCOL_VERSION);
        out.push(u8::from(self.resumed));
        out.extend_from_slice(&self.session_id);
        out.extend_from_slice(&self.next_expected.to_be_bytes());
        out.extend_from_slice(&self.caps.to_be_bytes());
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Welcome, Error> {
        let mut cursor = Cursor::new(bytes);
        check_version(cursor.u8("Welcome")?)?;
        let flags = cursor.u8("Welcome")?;
        if flags & !FLAG_RESUME != 0 {
            return Err(Error::ReservedFlags(flags));
        }
        let session_id = cursor.array("Welcome")?;
        let next_expected = cursor.u64("Welcome")?;
        let caps = cursor.u32("Welcome")?;
        cursor.finish("Welcome")?;
        Ok(Welcome {
            session_id,
            resumed: flags & FLAG_RESUME != 0,
            next_expected,
            caps,
        })
    }
}

fn check_version(version: u8) -> Result<(), Error> {
    if version == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(Error::UnknownVersion(version))
    }
}
