//! Minimal real RFB 3.8 / Apple `003.889` test server for protocol and end-to-end tests.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use aes::cipher::{BlockDecrypt, KeyInit};
use aes::Aes128;
use miniz_oxide::deflate::compress_to_vec_zlib;
use num_bigint::BigUint;

use crate::crypto::{md5, vnc_des_response};
use crate::wire::{client_msg, enc, sec, server_msg, PixelFormat};

#[derive(Debug, Clone)]
pub enum ServerAuth {
    None,
    VncPassword(String),
    AppleArd { username: String, password: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordedInput {
    Pointer { x: u16, y: u16, buttons: u8 },
    Key { keysym: u32, down: bool },
    Clipboard(String),
}

pub struct TestServer {
    addr: SocketAddr,
    inputs: Arc<Mutex<Vec<RecordedInput>>>,
    thread: Option<JoinHandle<()>>,
}

impl TestServer {
    pub fn start(
        width: u16,
        height: u16,
        desktop_name: &str,
        auth: ServerAuth,
        use_zrle: bool,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test RFB server");
        let addr = listener.local_addr().expect("local addr");
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let inputs_bg = Arc::clone(&inputs);
        let name = desktop_name.to_owned();
        let thread = thread::spawn(move || {
            for _ in 0..4 {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ =
                            serve_one(stream, width, height, &name, &auth, use_zrle, &inputs_bg);
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            addr,
            inputs,
            thread: Some(thread),
        }
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    pub fn inputs(&self) -> Vec<RecordedInput> {
        self.inputs.lock().unwrap().clone()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        for _ in 0..4 {
            if TcpStream::connect(self.addr).is_err() {
                break;
            }
        }
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

fn serve_one(
    mut stream: TcpStream,
    width: u16,
    height: u16,
    name: &str,
    auth: &ServerAuth,
    use_zrle: bool,
    inputs: &Arc<Mutex<Vec<RecordedInput>>>,
) -> std::io::Result<()> {
    let banner = match auth {
        ServerAuth::AppleArd { .. } => b"RFB 003.889\n",
        _ => b"RFB 003.008\n",
    };
    stream.write_all(banner)?;
    let mut client_ver = [0u8; 12];
    stream.read_exact(&mut client_ver)?;

    match auth {
        ServerAuth::None => {
            stream.write_all(&[1, sec::NONE])?;
            let mut chosen = [0u8; 1];
            stream.read_exact(&mut chosen)?;
            stream.write_all(&0u32.to_be_bytes())?;
        }
        ServerAuth::VncPassword(pass) => {
            stream.write_all(&[1, sec::VNC_AUTH])?;
            let mut chosen = [0u8; 1];
            stream.read_exact(&mut chosen)?;
            let challenge = [0x42u8; 16];
            stream.write_all(&challenge)?;
            let mut resp = [0u8; 16];
            stream.read_exact(&mut resp)?;
            let expected = vnc_des_response(pass, &challenge);
            if resp == expected {
                stream.write_all(&0u32.to_be_bytes())?;
            } else {
                send_auth_fail(&mut stream, "bad password")?;
                return Ok(());
            }
        }
        ServerAuth::AppleArd { username, password } => {
            stream.write_all(&[1, sec::ARD])?;
            let mut chosen = [0u8; 1];
            stream.read_exact(&mut chosen)?;
            let generator = 2u16;
            let prime = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xdf];
            let s_priv = BigUint::from(19u8);
            let p = BigUint::from_bytes_be(&prime);
            let s_pub = pad_be(&BigUint::from(generator).modpow(&s_priv, &p), prime.len());
            stream.write_all(&generator.to_be_bytes())?;
            stream.write_all(&(prime.len() as u16).to_be_bytes())?;
            stream.write_all(&prime)?;
            stream.write_all(&s_pub)?;

            let mut resp = vec![0u8; 128 + prime.len()];
            stream.read_exact(&mut resp)?;
            let c_pub = BigUint::from_bytes_be(&resp[128..]);
            let shared = pad_be(&c_pub.modpow(&s_priv, &p), prime.len());
            let aes_key = md5(&shared);
            let cipher = Aes128::new_from_slice(&aes_key).unwrap();
            let mut plain = [0u8; 128];
            for i in 0..8 {
                let mut block = aes::Block::clone_from_slice(&resp[i * 16..i * 16 + 16]);
                cipher.decrypt_block(&mut block);
                plain[i * 16..i * 16 + 16].copy_from_slice(&block);
            }
            let u = c_str(&plain[..64]);
            let pw = c_str(&plain[64..128]);
            if u == *username && pw == *password {
                stream.write_all(&0u32.to_be_bytes())?;
            } else {
                send_auth_fail(&mut stream, "invalid macOS credentials")?;
                return Ok(());
            }
        }
    }

    let mut client_init = [0u8; 1];
    stream.read_exact(&mut client_init)?;

    let mut init = Vec::new();
    init.extend_from_slice(&width.to_be_bytes());
    init.extend_from_slice(&height.to_be_bytes());
    PixelFormat::RGBA8888.encode(&mut init);
    init.extend_from_slice(&(name.len() as u32).to_be_bytes());
    init.extend_from_slice(name.as_bytes());
    stream.write_all(&init)?;

    let mut sent_initial = false;
    loop {
        let mut msg = [0u8; 1];
        if stream.read_exact(&mut msg).is_err() {
            return Ok(());
        }
        match msg[0] {
            client_msg::SET_PIXEL_FORMAT => {
                let mut skip = [0u8; 19];
                stream.read_exact(&mut skip)?;
            }
            client_msg::SET_ENCODINGS => {
                let mut hdr = [0u8; 3];
                stream.read_exact(&mut hdr)?;
                let n = usize::from(u16::from_be_bytes([hdr[1], hdr[2]]));
                let mut skip = vec![0u8; n * 4];
                stream.read_exact(&mut skip)?;
            }
            client_msg::FRAMEBUFFER_UPDATE_REQUEST => {
                let mut req = [0u8; 9];
                stream.read_exact(&mut req)?;
                if !sent_initial {
                    sent_initial = true;
                    send_test_frame(&mut stream, width, height, use_zrle)?;
                }
            }
            client_msg::KEY_EVENT => {
                let mut body = [0u8; 7];
                stream.read_exact(&mut body)?;
                let down = body[0] != 0;
                let keysym = u32::from_be_bytes([body[3], body[4], body[5], body[6]]);
                inputs
                    .lock()
                    .unwrap()
                    .push(RecordedInput::Key { keysym, down });
            }
            client_msg::POINTER_EVENT => {
                let mut body = [0u8; 5];
                stream.read_exact(&mut body)?;
                let buttons = body[0];
                let x = u16::from_be_bytes([body[1], body[2]]);
                let y = u16::from_be_bytes([body[3], body[4]]);
                inputs
                    .lock()
                    .unwrap()
                    .push(RecordedInput::Pointer { x, y, buttons });
            }
            client_msg::CLIENT_CUT_TEXT => {
                let mut hdr = [0u8; 7];
                stream.read_exact(&mut hdr)?;
                let len = u32::from_be_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]) as usize;
                let mut data = vec![0u8; len];
                stream.read_exact(&mut data)?;
                let text: String = data.iter().map(|&b| char::from(b)).collect();
                inputs.lock().unwrap().push(RecordedInput::Clipboard(text));
            }
            _ => return Ok(()),
        }
    }
}

fn send_test_frame(
    stream: &mut TcpStream,
    width: u16,
    height: u16,
    use_zrle: bool,
) -> std::io::Result<()> {
    let mut out = Vec::new();
    out.extend_from_slice(&[server_msg::FRAMEBUFFER_UPDATE, 0]);
    out.extend_from_slice(&1u16.to_be_bytes()); // 1 rect
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
    if use_zrle {
        out.extend_from_slice(&enc::ZRLE.to_be_bytes());
        // Solid teal tile(s) across the rect: subencoding 1 + 3-byte cpixel (R=10, G=120, B=220).
        let tiles_x = usize::from(width).div_ceil(64);
        let tiles_y = usize::from(height).div_ceil(64);
        let mut tiles = Vec::with_capacity(tiles_x * tiles_y * 4);
        for _ in 0..(tiles_x * tiles_y) {
            tiles.extend_from_slice(&[1, 10, 120, 220]);
        }
        let compressed = compress_to_vec_zlib(&tiles, 6);
        out.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
        out.extend_from_slice(&compressed);
    } else {
        out.extend_from_slice(&enc::RAW.to_be_bytes());
        for _ in 0..(usize::from(width) * usize::from(height)) {
            out.extend_from_slice(&[10, 120, 220, 255]);
        }
    }
    stream.write_all(&out)
}

fn send_auth_fail(stream: &mut TcpStream, reason: &str) -> std::io::Result<()> {
    stream.write_all(&1u32.to_be_bytes())?;
    stream.write_all(&(reason.len() as u32).to_be_bytes())?;
    stream.write_all(reason.as_bytes())
}

fn pad_be(v: &BigUint, len: usize) -> Vec<u8> {
    let raw = v.to_bytes_be();
    let mut out = vec![0u8; len];
    let start = len.saturating_sub(raw.len());
    let src = raw.len().saturating_sub(len);
    out[start..].copy_from_slice(&raw[src..]);
    out
}

fn c_str(buf: &[u8]) -> String {
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}
