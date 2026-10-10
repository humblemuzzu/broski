#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// One complete reassembled message, in the order the peer sent it.
    Message {
        stream: u32,
        bytes: Vec<u8>,
    },
    PeerClosed(u16),
    /// Nothing received for `dead_after_ms`; reported once per silence.
    Dead,
}
