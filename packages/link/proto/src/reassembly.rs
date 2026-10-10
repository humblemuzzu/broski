use crate::codec;
use crate::error::Error;
use crate::frame::{FLAG_DEFLATE, FLAG_MORE};

pub(crate) struct Reassembly {
    buf: Vec<u8>,
    stream: u32,
    deflate: bool,
    /// Fragments of one message are never interleaved, so one buffer covers all
    /// streams and `active` marks the message currently being collected.
    active: bool,
    max_message: usize,
}

impl Reassembly {
    pub(crate) fn new(max_message: usize) -> Self {
        Self {
            buf: Vec::new(),
            stream: 0,
            deflate: false,
            active: false,
            max_message,
        }
    }

    pub(crate) fn push(
        &mut self,
        stream: u32,
        flags: u8,
        payload: &[u8],
    ) -> Result<Option<Vec<u8>>, Error> {
        if self.active {
            if stream != self.stream {
                return Err(Error::InterleavedStream {
                    expected: self.stream,
                    got: stream,
                });
            }
        } else {
            self.active = true;
            self.stream = stream;
            self.deflate = flags & FLAG_DEFLATE != 0;
            self.buf.clear();
        }
        let len = self.buf.len() + payload.len();
        if len > self.max_message {
            return Err(Error::MessageTooLarge {
                len,
                max: self.max_message,
            });
        }
        self.buf.extend_from_slice(payload);
        if flags & FLAG_MORE != 0 {
            return Ok(None);
        }
        self.active = false;
        if self.deflate {
            let inflated = codec::inflate(&self.buf, self.max_message)?;
            self.buf.clear();
            Ok(Some(inflated))
        } else {
            Ok(Some(std::mem::take(&mut self.buf)))
        }
    }
}
