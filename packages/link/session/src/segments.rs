//! The largest TCP segment the phone sends.
//!
//! A Tailscale path over mobile data can silently drop packets near its 1280-byte MTU (measured on
//! 5G: 1178-byte packets passed, 1228-byte ones vanished, no ICMP came back). The phone's first
//! handshake message is about 1.2 KB, so on such a path it never arrived and every dial ended in a
//! handshake timeout. The daemon caps what it sends (`daemon/src/segments.rs`); only the phone can
//! cap what the phone sends. The two kernels take the cap at opposite moments: Linux (Android) only
//! before connecting, Apple's only after, when it binds only the side that set it. So the dial sets
//! it at both, and each kernel keeps the one it honours.

use std::io;
use std::os::fd::AsRawFd;

use tracing::debug;

/// The daemon's cap: 52 more bytes of IP and TCP headers stay under the size that vanished.
pub(crate) const MAX_SEGMENT: libc::c_int = 1100;

/// Caps the segments `socket` sends; a socket that refuses keeps its own size. Apple's kernel
/// refuses any cap above 512 before connecting, which is expected and harmless.
pub(crate) fn clamp(socket: &impl AsRawFd) {
    if let Err(error) = set_max_segment(socket) {
        debug!(%error, "could not limit the TCP segment size");
    }
}

fn set_max_segment(stream: &impl AsRawFd) -> io::Result<()> {
    let size = MAX_SEGMENT;
    // SAFETY: the descriptor is the live socket `stream` owns, and `size` is a `c_int` that
    // outlives the call, its length passed with it.
    let result = unsafe {
        libc::setsockopt(
            stream.as_raw_fd(),
            libc::IPPROTO_TCP,
            libc::TCP_MAXSEG,
            (&raw const size).cast(),
            libc::socklen_t::try_from(std::mem::size_of_val(&size)).unwrap_or(4),
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(test)]
pub(crate) fn max_segment(stream: &impl AsRawFd) -> libc::c_int {
    let mut size: libc::c_int = 0;
    let mut length = libc::socklen_t::try_from(std::mem::size_of_val(&size)).unwrap_or(4);
    // SAFETY: as above; `size` and `length` are live for the call and sized for a `c_int`.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::IPPROTO_TCP,
            libc::TCP_MAXSEG,
            (&raw mut size).cast(),
            &raw mut length,
        )
    };
    assert_eq!(result, 0, "{}", io::Error::last_os_error());
    size
}
