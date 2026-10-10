use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

use crate::error::{Error, Result};

pub(crate) const HEX: &[u8; 16] = b"0123456789abcdef";

pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn base64_decode_array<const N: usize>(value: &str) -> Result<[u8; N]> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| Error::Malformed("pair uri base64"))?;
    bytes
        .try_into()
        .map_err(|_| Error::Malformed("pair uri base64 length"))
}

pub(crate) fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push('%');
            out.push(HEX[(byte >> 4) as usize] as char);
            out.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    out
}

pub(crate) fn percent_decode(value: &str) -> Result<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_digit(*bytes.get(index + 1).ok_or(Error::Malformed("percent"))?)?;
            let low = hex_digit(*bytes.get(index + 2).ok_or(Error::Malformed("percent"))?)?;
            out.push((high << 4) | low);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| Error::Malformed("percent utf8"))
}

fn hex_digit(byte: u8) -> Result<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(Error::Malformed("percent digit")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_escapes_everything_outside_unreserved() {
        let value = "Broski Mac / caf\u{e9}";
        assert_eq!(percent_decode(&percent_encode(value)).unwrap(), value);
    }

    #[test]
    fn rejects_broken_escapes_and_non_utf8() {
        assert!(percent_decode("%").is_err());
        assert!(percent_decode("%a").is_err());
        assert!(percent_decode("%zz").is_err());
        assert!(percent_decode("%ff%ff").is_err());
        assert_eq!(percent_decode("%41a").unwrap(), "Aa");
    }
}
