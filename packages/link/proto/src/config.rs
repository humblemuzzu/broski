#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    /// Largest whole frame this session sends or accepts, header included.
    pub max_frame: usize,
    /// Cap on bytes sitting in the unacked buffer; `send` fails past it.
    pub max_unacked_bytes: usize,
    /// Largest message this session will reassemble or inflate.
    pub max_message: usize,
    /// Smallest message worth attempting to deflate.
    pub compress_threshold: usize,
    pub ack_delay_ms: u64,
    pub ack_every_frames: u32,
    pub ack_every_bytes: usize,
    pub ping_idle_ms: u64,
    pub dead_after_ms: u64,
}

impl Config {
    pub const fn new(max_frame: usize) -> Self {
        Self {
            max_frame,
            max_unacked_bytes: 16 * 1024 * 1024,
            max_message: 32 * 1024 * 1024,
            compress_threshold: 1024,
            ack_delay_ms: 25,
            ack_every_frames: 16,
            ack_every_bytes: 64 * 1024,
            ping_idle_ms: 15_000,
            dead_after_ms: 45_000,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::new(65_000)
    }
}
