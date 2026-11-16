//! The largest TCP segment the daemon sends on a LAN socket.
//!
//! A Tailscale path over mobile data can silently drop packets close to its 1280-byte MTU: measured
//! on a phone on 5G, 1178-byte packets passed while 1228-byte ones vanished, with no ICMP coming
//! back. TCP then resends the same full-size segment until the phone gives up and reconnects, so a
//! session's first screen (a snapshot and a page of transcript) never arrives while small frames
//! do. Segments of `MAX_SEGMENT` bytes, 52 more with their IP and TCP headers, stay under that.

use std::io;
use std::os::fd::AsRawFd;

use tokio::net::TcpStream;
use tracing::debug;

pub const MAX_SEGMENT: libc::c_int = 1100;

/// Caps the segments `stream` sends; a socket that refuses keeps its own size.
pub fn clamp(stream: &mut TcpStream) {
    if let Err(error) = set_max_segment(stream) {
        debug!(%error, "could not limit the TCP segment size");
    }
}

fn set_max_segment(stream: &TcpStream) -> io::Result<()> {
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
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_accepted_socket_sends_segments_no_larger_than_the_cap() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (_client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
        let (server, _) = accepted.unwrap();
        set_max_segment(&server).expect("the kernel takes the cap");
        if cfg!(target_os = "macos") {
            assert!(
                max_segment(&server) <= MAX_SEGMENT,
                "macOS reads the cap back"
            );
        }
    }

    fn max_segment(stream: &TcpStream) -> libc::c_int {
        let mut size: libc::c_int = 0;
        let mut length = libc::socklen_t::try_from(std::mem::size_of_val(&size)).unwrap();
        // SAFETY: the descriptor is live, and `size` and `length` outlive the call.
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
}
