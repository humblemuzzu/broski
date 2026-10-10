use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use broski_link_core::crypto::PairingOffer;

use crate::buf::{borrow, into_blob, BlBuf};
use crate::error::{caught, fail, invalid, OK, PANIC};

const HEX: &[u8; 16] = b"0123456789abcdef";

/// Writes `broski://pair?v=2&...` as JSON:
/// `{"fingerprint","secret","relay","lan","name","expires_at"}`.
///
/// # Safety
///
/// `uri` must point to `len` readable bytes, `out_json` to writable `BlBuf`
/// storage.
#[no_mangle]
pub unsafe extern "C" fn bl_pairing_parse(uri: *const u8, len: usize, out_json: *mut BlBuf) -> i32 {
    caught(PANIC, || {
        // SAFETY: the caller guarantees `len` readable bytes at `uri`.
        let Some(bytes) = (unsafe { borrow(uri, len) }) else {
            return invalid("the uri must not be null");
        };
        if out_json.is_null() {
            return invalid("out_json must not be null");
        }
        let Ok(text) = std::str::from_utf8(bytes) else {
            return invalid("the pairing uri is not UTF-8");
        };
        let offer = match PairingOffer::parse(text) {
            Ok(offer) => offer,
            Err(error) => return fail(error.into()),
        };
        // SAFETY: `out_json` is non-null and the caller guarantees a writable BlBuf.
        unsafe { out_json.write(into_blob(pairing_json(&offer).into_bytes())) };
        OK
    })
}

fn pairing_json(offer: &PairingOffer) -> String {
    let mut out = String::with_capacity(160);
    out.push_str("{\"fingerprint\":\"");
    out.push_str(&URL_SAFE_NO_PAD.encode(offer.fingerprint));
    out.push_str("\",\"secret\":\"");
    out.push_str(&URL_SAFE_NO_PAD.encode(offer.secret));
    out.push_str("\",\"relay\":");
    match &offer.relay {
        Some(relay) => push_json_string(&mut out, relay),
        None => out.push_str("null"),
    }
    out.push_str(",\"lan\":[");
    for (index, host) in offer.lan.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_json_string(&mut out, host);
    }
    out.push_str("],\"name\":");
    push_json_string(&mut out, &offer.name);
    out.push_str(",\"expires_at\":");
    out.push_str(&offer.expires_at.to_string());
    out.push('}');
    out
}

fn push_json_string(out: &mut String, value: &str) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                let code = control as u32;
                out.push_str("\\u00");
                out.push(HEX[(code >> 4) as usize] as char);
                out.push(HEX[(code & 0x0f) as usize] as char);
            }
            other => out.push(other),
        }
    }
    out.push('"');
}
