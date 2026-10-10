use crate::error::Error;

pub(crate) struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    pub(crate) fn u8(&mut self, what: &'static str) -> Result<u8, Error> {
        let byte = *self.bytes.get(self.pos).ok_or(Error::Truncated { what })?;
        self.pos += 1;
        Ok(byte)
    }

    pub(crate) fn u16(&mut self, what: &'static str) -> Result<u16, Error> {
        Ok(u16::from_be_bytes(self.array(what)?))
    }

    pub(crate) fn u32(&mut self, what: &'static str) -> Result<u32, Error> {
        Ok(u32::from_be_bytes(self.array(what)?))
    }

    pub(crate) fn u64(&mut self, what: &'static str) -> Result<u64, Error> {
        Ok(u64::from_be_bytes(self.array(what)?))
    }

    pub(crate) fn array<const N: usize>(&mut self, what: &'static str) -> Result<[u8; N], Error> {
        let end = self.pos + N;
        let array = self
            .bytes
            .get(self.pos..end)
            .and_then(|slice| slice.try_into().ok())
            .ok_or(Error::Truncated { what })?;
        self.pos = end;
        Ok(array)
    }

    pub(crate) fn rest(&self) -> &'a [u8] {
        &self.bytes[self.pos..]
    }

    pub(crate) fn finish(&self, what: &'static str) -> Result<(), Error> {
        let len = self.bytes.len() - self.pos;
        if len == 0 {
            Ok(())
        } else {
            Err(Error::TrailingBytes { what, len })
        }
    }
}
