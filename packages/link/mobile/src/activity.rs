//! How an activity reads in the transcript and how long text is cut to a row (`broski-render`),
//! decided once for both apps. Pure functions of their input, callable from any thread.

use broski_contract::Activity;
use broski_render::{ActivityLook, ActivityTone, ClipEnd, TextClip};

/// The tone, facts and closed preview of an activity's row.
#[uniffi::export]
pub fn activity_look(activity: Activity) -> ActivityLook {
    broski_render::activity_look(&activity)
}

/// At most `max_lines` lines of `text` from the end `keep` names, within a byte bound, and how many
/// lines it leaves out.
#[uniffi::export]
pub fn clip_text(text: String, max_lines: u32, keep: ClipEnd) -> TextClip {
    broski_render::clip_text(&text, max_lines, keep)
}

/// A duration as the chat words it: `12s`, `2m`, `1h 5m`.
#[uniffi::export]
pub fn format_duration(milliseconds: i64) -> String {
    broski_render::format_duration(milliseconds)
}

#[uniffi::remote(Enum)]
pub enum ActivityTone {
    Plain,
    Working,
    Failed,
}

#[uniffi::remote(Record)]
pub struct ActivityLook {
    pub tone: ActivityTone,
    pub facts: Vec<String>,
    pub preview: Option<String>,
    pub log: Option<TextClip>,
    pub opens: bool,
}

#[uniffi::remote(Enum)]
pub enum ClipEnd {
    Head,
    Tail,
}

#[uniffi::remote(Record)]
pub struct TextClip {
    pub text: String,
    pub hidden_lines: u32,
}
