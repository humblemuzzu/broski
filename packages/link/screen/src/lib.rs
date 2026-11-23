//! Shared RFB 3.8 + Apple Screen Sharing (`003.889`) client engine for Broski iOS and Android.

mod client;
mod crypto;
mod decode;
mod decode_hextile;
mod decode_zrle;
mod error;
mod framebuffer;
mod handshake;
pub mod keys;
#[cfg(any(test, feature = "test-server"))]
pub mod test_server;
pub mod tunnel;
mod wire;

pub use client::{AuthScheme, Client, ScreenCredentials, ScreenEvent};
pub use decode::CursorShape;
pub use error::{Error, Result};
pub use framebuffer::Rect;
pub use keys::{keysym, ScreenShortcut};
pub use tunnel::{
    ClientTunnelMsg, ScreenCloseReason, ServerTunnelMsg, DEFAULT_SCREEN_PORT, MAX_TUNNEL_CHUNK,
};
pub use wire::{MAX_HEIGHT, MAX_WIDTH};

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    use crate::test_server::{RecordedInput, ServerAuth, TestServer};
    use crate::{AuthScheme, Client, ScreenCredentials, ScreenEvent, ScreenShortcut};

    fn drive_until_frame(client: &mut Client, stream: &mut TcpStream) -> Vec<ScreenEvent> {
        let mut collected = Vec::new();
        let mut buf = [0u8; 4096];
        for _ in 0..32 {
            while let Some(out) = client.poll_write() {
                stream.write_all(&out).unwrap();
            }
            let n = stream.read(&mut buf).unwrap();
            assert!(n > 0, "unexpected EOF from test server");
            client.feed(&buf[..n]).unwrap();
            while let Some(ev) = client.poll_event() {
                let done = matches!(ev, ScreenEvent::Frame { .. });
                collected.push(ev);
                if done {
                    return collected;
                }
            }
        }
        panic!("did not receive Frame event");
    }

    #[test]
    fn apple_ard_zrle_frame_and_input_roundtrip() {
        let server = TestServer::start(
            128,
            64,
            "MacBook Pro",
            ServerAuth::AppleArd {
                username: "sam".to_owned(),
                password: "secret!".to_owned(),
            },
            true,
        );
        let mut stream = TcpStream::connect(("127.0.0.1", server.port())).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();

        let mut client = Client::new(Some(ScreenCredentials {
            username: "sam".to_owned(),
            password: "secret!".to_owned(),
        }));
        let events = drive_until_frame(&mut client, &mut stream);
        assert!(events.iter().any(|e| matches!(
            e,
            ScreenEvent::Ready {
                width: 128,
                height: 64,
                apple_server: true,
                ..
            }
        )));
        let frame = events
            .iter()
            .find_map(|e| match e {
                ScreenEvent::Frame { rgba, .. } => Some(rgba),
                _ => None,
            })
            .unwrap();
        assert_eq!(&frame[0..4], &[10, 120, 220, 255]);

        client.send_pointer(40, 20, 1);
        client.type_text("A@");
        client.send_shortcut(ScreenShortcut::SpaceRight);
        client.set_clipboard("hello mac");
        while let Some(out) = client.poll_write() {
            stream.write_all(&out).unwrap();
        }
        drop(stream);
        std::thread::sleep(Duration::from_millis(50));

        let inputs = server.inputs();
        assert!(inputs.contains(&RecordedInput::Pointer {
            x: 40,
            y: 20,
            buttons: 1
        }));
        assert!(inputs.contains(&RecordedInput::Key {
            keysym: u32::from(b'@'),
            down: true
        }));
        assert!(inputs.contains(&RecordedInput::Clipboard("hello mac".to_owned())));
    }

    #[test]
    fn prompts_for_credentials_when_not_supplied_upfront() {
        let server = TestServer::start(
            64,
            64,
            "Mac",
            ServerAuth::VncPassword("pass123".to_owned()),
            false,
        );
        let mut stream = TcpStream::connect(("127.0.0.1", server.port())).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut client = Client::new(None);
        let mut buf = [0u8; 256];
        let mut prompted = false;
        for _ in 0..8 {
            while let Some(out) = client.poll_write() {
                stream.write_all(&out).unwrap();
            }
            let n = stream.read(&mut buf).unwrap();
            client.feed(&buf[..n]).unwrap();
            while let Some(ev) = client.poll_event() {
                if let ScreenEvent::AuthRequired { schemes } = ev {
                    assert_eq!(schemes, vec![AuthScheme::VncPassword]);
                    prompted = true;
                }
            }
            if prompted {
                break;
            }
        }
        assert!(prompted);
        client
            .provide_credentials(ScreenCredentials {
                username: String::new(),
                password: "pass123".to_owned(),
            })
            .unwrap();
        let events = drive_until_frame(&mut client, &mut stream);
        assert!(events
            .iter()
            .any(|e| matches!(e, ScreenEvent::Frame { .. })));
    }

    #[test]
    fn large_zrle_rect_with_over_1024_raw_tiles_decodes() {
        use miniz_oxide::deflate::compress_to_vec_zlib;

        let (w, h) = (2112u16, 2112u16);
        let mut tiles = Vec::with_capacity(1089 * (1 + 64 * 64 * 3));
        for _ in 0..1089 {
            tiles.push(0);
            tiles.resize(tiles.len() + 64 * 64 * 3, 0x55);
        }
        let compressed = compress_to_vec_zlib(&tiles, 1);

        let mut client = Client::new(None);
        client.feed(b"RFB 003.008\n").unwrap();
        let _ = client.poll_write();
        client.feed(&[1, 1]).unwrap();
        let _ = client.poll_write();
        client.feed(&0u32.to_be_bytes()).unwrap();
        let _ = client.poll_write();

        let mut init = Vec::new();
        init.extend_from_slice(&w.to_be_bytes());
        init.extend_from_slice(&h.to_be_bytes());
        crate::wire::PixelFormat::RGBA8888.encode(&mut init);
        init.extend_from_slice(&0u32.to_be_bytes());
        client.feed(&init).unwrap();
        let _ = client.poll_write();

        let mut fbu = vec![0, 0, 0, 1];
        fbu.extend_from_slice(&0u16.to_be_bytes());
        fbu.extend_from_slice(&0u16.to_be_bytes());
        fbu.extend_from_slice(&w.to_be_bytes());
        fbu.extend_from_slice(&h.to_be_bytes());
        fbu.extend_from_slice(&16i32.to_be_bytes());
        fbu.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
        fbu.extend_from_slice(&compressed);
        client.feed(&fbu).unwrap();

        let mut saw_frame = false;
        while let Some(ev) = client.poll_event() {
            if matches!(ev, ScreenEvent::Frame { .. }) {
                saw_frame = true;
            }
        }
        assert!(saw_frame);
    }

    #[test]
    fn zlib_stream_end_with_trailing_bytes_does_not_hang() {
        use miniz_oxide::deflate::compress_to_vec_zlib;

        let mut client = Client::new(None);
        client.feed(b"RFB 003.008\n").unwrap();
        let _ = client.poll_write();
        client.feed(&[1, 1]).unwrap();
        let _ = client.poll_write();
        client.feed(&0u32.to_be_bytes()).unwrap();
        let _ = client.poll_write();
        let mut init = Vec::new();
        init.extend_from_slice(&1u16.to_be_bytes());
        init.extend_from_slice(&1u16.to_be_bytes());
        crate::wire::PixelFormat::RGBA8888.encode(&mut init);
        init.extend_from_slice(&0u32.to_be_bytes());
        client.feed(&init).unwrap();

        let mut compressed = compress_to_vec_zlib(&[1, 2, 3, 255], 6);
        compressed.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let mut fbu = vec![0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1];
        fbu.extend_from_slice(&6i32.to_be_bytes());
        fbu.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
        fbu.extend_from_slice(&compressed);
        client.feed(&fbu).unwrap();
        assert!(client.is_ready());
    }

    #[test]
    fn provide_credentials_while_running_keeps_session_intact() {
        let mut client = Client::new(None);
        client.feed(b"RFB 003.008\n").unwrap();
        client.feed(&[1, 1]).unwrap();
        client.feed(&0u32.to_be_bytes()).unwrap();
        let mut init = Vec::new();
        init.extend_from_slice(&4u16.to_be_bytes());
        init.extend_from_slice(&4u16.to_be_bytes());
        crate::wire::PixelFormat::RGBA8888.encode(&mut init);
        init.extend_from_slice(&0u32.to_be_bytes());
        client.feed(&init).unwrap();
        assert!(client.is_ready());

        assert!(client
            .provide_credentials(ScreenCredentials::default())
            .is_err());
        assert!(client.is_ready());
    }

    #[test]
    fn split_security_result_preserves_server_reason() {
        let mut client = Client::new(None);
        client.feed(b"RFB 003.008\n").unwrap();
        client.feed(&[1, 1]).unwrap();
        client.feed(&1u32.to_be_bytes()).unwrap();
        let reason = b"bad mac password";
        client.feed(&(reason.len() as u32).to_be_bytes()).unwrap();
        let err = client.feed(reason).unwrap_err();
        assert_eq!(err, crate::Error::AuthFailed("bad mac password".to_owned()));
    }
}
