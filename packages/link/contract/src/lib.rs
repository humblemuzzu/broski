//! The Broski backend contract for the phone core: the models generated from the bridge's zod schemas
//! (`packages/bridge/src/contract`, protocol 1.0), the frame they travel in, and the session reducer.
//! The bridge's generated fixtures hold all of it equal to the TypeScript.

mod codec;
mod form;
mod frame;
// A union holds its members inline, as the schema nests them; boxing the large ones would put a `Box`
// into every Rust construction and match of those variants.
#[allow(clippy::large_enum_variant)]
mod generated;
mod json_value;
mod reducer;
mod run_items;
pub mod tagged;

pub use form::{form_field_default, form_field_shown};
pub use frame::{decode_frame, encode_frame, FrameError};
pub use generated::*;
pub use json_value::{JsonMember, JsonValue};
pub use reducer::{apply_event, empty_snapshot, session_status};
pub use tagged::Tagged;

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
