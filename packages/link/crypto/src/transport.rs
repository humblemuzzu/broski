use crate::error::{Error, Result};
use crate::suite::{TransportState, MAX_NOISE_MESSAGE, TAG_LEN};

pub const MAX_PLAINTEXT: usize = MAX_NOISE_MESSAGE - TAG_LEN;

/// One `Transport` per connection: Noise's counter nonces require the peer to receive
/// each sealed message exactly once, in the order it was sent.
pub struct Transport {
    inner: TransportState,
}

impl Transport {
    pub(crate) fn new(inner: TransportState) -> Self {
        Self { inner }
    }

    pub fn seal(&mut self, plaintext: &[u8], out: &mut Vec<u8>) -> Result<()> {
        if plaintext.len() > MAX_PLAINTEXT {
            return Err(Error::PayloadTooLarge {
                len: plaintext.len(),
                max: MAX_PLAINTEXT,
            });
        }

        let start = out.len();
        out.extend_from_slice(plaintext);
        out.resize(start + plaintext.len() + TAG_LEN, 0);
        match self.inner.send_in_place(&mut out[start..], plaintext.len()) {
            Ok(_) => Ok(()),
            Err(error) => {
                out.truncate(start);
                Err(error.into())
            }
        }
    }

    pub fn open(&mut self, ciphertext: &[u8], out: &mut Vec<u8>) -> Result<()> {
        if ciphertext.len() < TAG_LEN {
            return Err(Error::Malformed("ciphertext too short"));
        }
        if ciphertext.len() > MAX_NOISE_MESSAGE {
            return Err(Error::MessageTooLarge {
                len: ciphertext.len(),
                max: MAX_NOISE_MESSAGE,
            });
        }

        let start = out.len();
        out.extend_from_slice(ciphertext);
        match self
            .inner
            .receive_in_place(&mut out[start..], ciphertext.len())
        {
            Ok(written) => {
                out.truncate(start + written);
                Ok(())
            }
            Err(error) => {
                out.truncate(start);
                Err(error.into())
            }
        }
    }
}
