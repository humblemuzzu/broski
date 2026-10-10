use miniz_oxide::inflate::TINFLStatus;

use crate::error::Error;

const COMPRESSION_LEVEL: u8 = 1;

pub(crate) fn deflate_if_smaller(input: &[u8], threshold: usize) -> Option<Vec<u8>> {
    if input.len() < threshold {
        return None;
    }
    let compressed = miniz_oxide::deflate::compress_to_vec(input, COMPRESSION_LEVEL);
    if compressed.len() < input.len() {
        Some(compressed)
    } else {
        None
    }
}

pub(crate) fn inflate(input: &[u8], max_message: usize) -> Result<Vec<u8>, Error> {
    miniz_oxide::inflate::decompress_to_vec_with_limit(input, max_message).map_err(|error| {
        match error.status {
            TINFLStatus::HasMoreOutput => Error::InflateTooLarge { max: max_message },
            _ => Error::Inflate,
        }
    })
}
