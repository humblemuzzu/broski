//! Broski's formatter (`broski-render`'s `format`): the agent's markdown as keyed blocks of styled
//! spans, and the gallery's samples. Pure functions callable without a `Phone` from any thread.

use broski_render::{FormatBlock, FormatContent, FormatSample, FormatSpan};

/// `text` as blocks to lay out in order; each block's `key` stays the same while text is appended,
/// so a streaming message redraws only its last block. `streaming` while more text is coming.
#[uniffi::export]
pub fn format_markdown(text: String, streaming: bool) -> Vec<FormatBlock> {
    broski_render::format_markdown(&text, streaming)
}

/// The formatting gallery's samples: agent-shaped text with every case the formatter must draw.
#[uniffi::export]
pub fn format_samples() -> Vec<FormatSample> {
    broski_render::format_samples()
}

#[uniffi::remote(Record)]
pub struct FormatBlock {
    pub key: String,
    pub content: FormatContent,
}

#[uniffi::remote(Enum)]
pub enum FormatContent {
    Paragraph {
        spans: Vec<FormatSpan>,
    },
    Code {
        language: Option<String>,
        text: String,
        closed: bool,
    },
}

#[uniffi::remote(Record)]
pub struct FormatSpan {
    pub text: String,
    pub code: bool,
}

#[uniffi::remote(Record)]
pub struct FormatSample {
    pub title: String,
    pub text: String,
}
