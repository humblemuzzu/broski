//! The bridge's generated fixtures (`packages/bridge/contract-fixtures`) are the spec this crate holds
//! itself to: every sample of every type, the fake session's stream in its frames, the reducer's trace
//! step by step, and the shared bounds.

mod canonical;
mod constants;
mod frames;
mod generated;
mod reducer_trace;
mod samples;
mod strictness;
mod support;
