//! BroskiCore, the library the iOS and Android apps link: the phone's client core (`broski-client`)
//! exported to Swift and Kotlin through UniFFI, with the functions the notification handlers and the
//! pairing scanner call without a `Phone`, and the rendering both apps draw the same way
//! (`broski-render`), including how a tool call reads in the work fold, how an activity reads in
//! the transcript, how long text is cut to a row, and what a form shows.
//!
//! Every export is a thin wrapper; the behaviour lives in the client, session, contract and render
//! crates.
//! No export takes a foreign callback: updates are pulled (`next_event`, `next_update`,
//! `next_change`). Every async export can be polled from a Swift task or a Kotlin coroutine without
//! blocking its thread, because the client waits on `Notify`s and runs its timers on the link
//! runtime's own thread.

mod activity;
mod format;
mod inbox;
mod link;
mod machine;
mod offer;
mod phone;
mod push;
mod record;
mod render;
mod values;
mod version;
mod views;
mod work;

pub use activity::{activity_look, clip_text, format_duration};
pub use format::{
    format_json, format_markdown, format_plain_text, format_samples, language_label, table_csv,
    table_html, table_markdown, table_tsv,
};
pub use inbox::Inbox;
pub use link::{LinkRoute, LinkStatus};
pub use machine::Machine;
pub use offer::{parse_pairing_offer, PairingOffer};
pub use phone::{new_identity_secret, Phone};
pub use push::{
    decision_letter, open_notification, HttpHeader, LetterRequest, PushDecision, PushNotification,
};
pub use record::MachineRecord;
pub use render::{
    file_change_diff, git_diff_file, highlight, language_for_path, normalize_language,
    parse_unified_diff, side_by_side,
};
pub use version::{core_version, CoreVersion};
pub use views::{SessionList, SessionView, TerminalView};
pub use work::{
    fold_counts, form_field_default, form_field_shown, tool_arguments, tool_body, tool_look,
};

uniffi::setup_scaffolding!();
