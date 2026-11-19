//! Calls the wasm2c-compiled `@pierre/highlights` C module behind one lock and converts its
//! UTF-16 token records into `CodeLine` spans.

use std::sync::Mutex;

use super::kinds;
use super::{CodeLine, CodeSpan, TokenKind};

const LINE_BREAK: u32 = u32::MAX;

static ENGINE_LOCK: Mutex<()> = Mutex::new(());

extern "C" {
    fn broski_highlights_tokenize(
        source: *const u8,
        length: usize,
        language: u8,
        records: *mut *const u32,
    ) -> i64;
}

#[no_mangle]
pub extern "C" fn broski_highlights_is_id_start(code_point: u32) -> u32 {
    char::from_u32(code_point).map_or(0, |ch| u32::from(unicode_ident::is_xid_start(ch)))
}

#[no_mangle]
pub extern "C" fn broski_highlights_is_id_continue(code_point: u32) -> u32 {
    char::from_u32(code_point).map_or(0, |ch| {
        u32::from(unicode_ident::is_xid_continue(ch) || ch == '\u{200C}' || ch == '\u{200D}')
    })
}

/// Tokenizes `code` (assumed already within highlight bounds) with Pierre language `lang_id`.
/// Returns `None` if the Wasm module trapped or failed to grow memory.
pub(super) fn tokenize(code: &str, lang_id: u8) -> Option<Vec<CodeLine>> {
    if code.is_empty() {
        return Some(Vec::new());
    }
    let _guard = ENGINE_LOCK.lock().unwrap_or_else(|err| err.into_inner());
    let mut records_ptr: *const u32 = std::ptr::null();
    // SAFETY: `code` is valid for `code.len()` bytes; `ENGINE_LOCK` serializes access to the
    // single wasm2c instance so `records_ptr` stays valid until `_guard` drops.
    let count =
        unsafe { broski_highlights_tokenize(code.as_ptr(), code.len(), lang_id, &mut records_ptr) };
    if count < 0 {
        return None;
    }
    let count = usize::try_from(count).ok()?;
    let records = if count == 0 {
        &[]
    } else {
        // SAFETY: `broski_highlights_tokenize` validated bounds and 4-byte alignment inside the
        // instance's linear memory, and we hold `ENGINE_LOCK` while reading it.
        unsafe { std::slice::from_raw_parts(records_ptr, count) }
    };
    Some(decode_lines(code, records))
}

fn decode_lines(code: &str, records: &[u32]) -> Vec<CodeLine> {
    let mut lines = Vec::new();
    let mut spans = Vec::new();
    let mut cursor = Utf16Cursor::new(code);
    for &[end_u16, token_id] in records.as_chunks::<2>().0 {
        let end_u16 = end_u16 as usize;
        if token_id == LINE_BREAK {
            lines.push(CodeLine {
                spans: std::mem::take(&mut spans),
            });
            cursor.advance_to(end_u16);
        } else {
            let start = cursor.byte_pos;
            let end = cursor.advance_to(end_u16);
            if end > start {
                push_span(&mut spans, &code[start..end], kinds::kind_for(token_id));
            }
        }
    }
    if !code.ends_with('\n') {
        if let Some(last) = spans.last_mut() {
            if last.text.ends_with('\r') {
                last.text.pop();
                if last.text.is_empty() {
                    spans.pop();
                }
            }
        }
        lines.push(CodeLine { spans });
    }
    lines
}

fn push_span(spans: &mut Vec<CodeSpan>, text: &str, kind: TokenKind) {
    if text.is_empty() {
        return;
    }
    match spans.last_mut() {
        Some(last) if last.kind == kind => last.text.push_str(text),
        _ => spans.push(CodeSpan {
            text: text.to_owned(),
            kind,
        }),
    }
}

/// Maps monotonically increasing UTF-16 code unit offsets to UTF-8 byte offsets in O(n) total.
struct Utf16Cursor<'a> {
    code: &'a str,
    ascii: bool,
    byte_pos: usize,
    utf16_pos: usize,
}

impl<'a> Utf16Cursor<'a> {
    fn new(code: &'a str) -> Self {
        Self {
            code,
            ascii: code.is_ascii(),
            byte_pos: 0,
            utf16_pos: 0,
        }
    }

    fn advance_to(&mut self, target_utf16: usize) -> usize {
        if self.ascii {
            self.byte_pos = target_utf16.min(self.code.len());
            self.utf16_pos = self.byte_pos;
            return self.byte_pos;
        }
        while self.utf16_pos < target_utf16 {
            let Some(ch) = self.code[self.byte_pos..].chars().next() else {
                break;
            };
            self.byte_pos += ch.len_utf8();
            self.utf16_pos += ch.len_utf16();
        }
        self.byte_pos
    }
}
