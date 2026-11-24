pub const MAX_WIDTH: u16 = 8192;
pub const MAX_HEIGHT: u16 = 4320;
pub const MAX_CLIPBOARD_BYTES: usize = 256 * 1024;
pub const MAX_ZLIB_RECT_BYTES: usize = 64 * 1024 * 1024;

pub mod sec {
    pub const NONE: u8 = 1;
    pub const VNC_AUTH: u8 = 2;
    pub const ARD: u8 = 30;
}

pub mod enc {
    pub const RAW: i32 = 0;
    pub const COPY_RECT: i32 = 1;
    pub const HEXTILE: i32 = 5;
    pub const ZLIB: i32 = 6;
    pub const ZRLE: i32 = 16;
    pub const DESKTOP_SIZE: i32 = -223;
    pub const POINTER_POS: i32 = -232;
    pub const RICH_CURSOR: i32 = -239;
    pub const EXTENDED_DESKTOP_SIZE: i32 = -308;
}

pub mod server_msg {
    pub const FRAMEBUFFER_UPDATE: u8 = 0;
    pub const SET_COLOUR_MAP_ENTRIES: u8 = 1;
    pub const BELL: u8 = 2;
    pub const SERVER_CUT_TEXT: u8 = 3;
}

pub mod client_msg {
    pub const SET_PIXEL_FORMAT: u8 = 0;
    pub const SET_ENCODINGS: u8 = 2;
    pub const FRAMEBUFFER_UPDATE_REQUEST: u8 = 3;
    pub const KEY_EVENT: u8 = 4;
    pub const POINTER_EVENT: u8 = 5;
    pub const CLIENT_CUT_TEXT: u8 = 6;
    pub const SET_DESKTOP_SIZE: u8 = 251;
}

/// Preferred 32-bit little-endian RGBA8888 pixel format (matches iOS CGImage & Android Bitmap).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelFormat {
    pub bits_per_pixel: u8,
    pub depth: u8,
    pub big_endian: bool,
    pub true_color: bool,
    pub red_max: u16,
    pub green_max: u16,
    pub blue_max: u16,
    pub red_shift: u8,
    pub green_shift: u8,
    pub blue_shift: u8,
}

impl PixelFormat {
    pub const RGBA8888: PixelFormat = PixelFormat {
        bits_per_pixel: 32,
        depth: 24,
        big_endian: false,
        true_color: true,
        red_max: 255,
        green_max: 255,
        blue_max: 255,
        red_shift: 0,
        green_shift: 8,
        blue_shift: 16,
    };

    pub fn bytes_per_pixel(self) -> usize {
        usize::from(self.bits_per_pixel / 8).max(1)
    }

    pub fn is_cpixel_24(self) -> bool {
        self.true_color
            && self.bits_per_pixel == 32
            && self.depth <= 24
            && self.red_max <= 255
            && self.green_max <= 255
            && self.blue_max <= 255
            && ((u32::from(self.red_max) << self.red_shift)
                | (u32::from(self.green_max) << self.green_shift)
                | (u32::from(self.blue_max) << self.blue_shift))
                <= 0x00ff_ffff
    }

    pub fn cpixel_bytes(self) -> usize {
        if self.is_cpixel_24() {
            3
        } else {
            self.bytes_per_pixel()
        }
    }

    pub fn encode(self, out: &mut Vec<u8>) {
        out.push(self.bits_per_pixel);
        out.push(self.depth);
        out.push(u8::from(self.big_endian));
        out.push(u8::from(self.true_color));
        out.extend_from_slice(&self.red_max.to_be_bytes());
        out.extend_from_slice(&self.green_max.to_be_bytes());
        out.extend_from_slice(&self.blue_max.to_be_bytes());
        out.push(self.red_shift);
        out.push(self.green_shift);
        out.push(self.blue_shift);
        out.extend_from_slice(&[0u8; 3]);
    }

    pub fn decode_pixel(self, bytes: &[u8]) -> [u8; 4] {
        let raw = match bytes.len() {
            1 => u32::from(bytes[0]),
            2 => {
                if self.big_endian {
                    u32::from(u16::from_be_bytes([bytes[0], bytes[1]]))
                } else {
                    u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
                }
            }
            3 => {
                if self.big_endian {
                    (u32::from(bytes[0]) << 16) | (u32::from(bytes[1]) << 8) | u32::from(bytes[2])
                } else {
                    u32::from(bytes[0]) | (u32::from(bytes[1]) << 8) | (u32::from(bytes[2]) << 16)
                }
            }
            _ => {
                if self.big_endian {
                    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
                } else {
                    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
                }
            }
        };
        let r = scale_channel(
            (raw >> self.red_shift) & u32::from(self.red_max),
            self.red_max,
        );
        let g = scale_channel(
            (raw >> self.green_shift) & u32::from(self.green_max),
            self.green_max,
        );
        let b = scale_channel(
            (raw >> self.blue_shift) & u32::from(self.blue_max),
            self.blue_max,
        );
        [r, g, b, 255]
    }
}

fn scale_channel(val: u32, max: u16) -> u8 {
    match max {
        0 => 0,
        255 => val as u8,
        m => ((val * 255 + u32::from(m) / 2) / u32::from(m)) as u8,
    }
}

pub fn write_set_pixel_format(out: &mut Vec<u8>, pf: PixelFormat) {
    out.extend_from_slice(&[client_msg::SET_PIXEL_FORMAT, 0, 0, 0]);
    pf.encode(out);
}

pub fn write_set_encodings(out: &mut Vec<u8>, encodings: &[i32]) {
    out.push(client_msg::SET_ENCODINGS);
    out.push(0);
    out.extend_from_slice(&(encodings.len() as u16).to_be_bytes());
    for &enc in encodings {
        out.extend_from_slice(&enc.to_be_bytes());
    }
}

pub fn write_fb_update_request(
    out: &mut Vec<u8>,
    incremental: bool,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
) {
    out.push(client_msg::FRAMEBUFFER_UPDATE_REQUEST);
    out.push(u8::from(incremental));
    out.extend_from_slice(&x.to_be_bytes());
    out.extend_from_slice(&y.to_be_bytes());
    out.extend_from_slice(&w.to_be_bytes());
    out.extend_from_slice(&h.to_be_bytes());
}

pub fn write_key_event(out: &mut Vec<u8>, keysym: u32, down: bool) {
    out.push(client_msg::KEY_EVENT);
    out.push(u8::from(down));
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&keysym.to_be_bytes());
}

pub fn write_pointer_event(out: &mut Vec<u8>, x: u16, y: u16, buttons: u8) {
    out.push(client_msg::POINTER_EVENT);
    out.push(buttons);
    out.extend_from_slice(&x.to_be_bytes());
    out.extend_from_slice(&y.to_be_bytes());
}

pub fn write_client_cut_text(out: &mut Vec<u8>, text: &str) {
    // RFB ClientCutText is ISO-8859-1; keep ASCII/Latin-1 bytes cleanly bounded.
    let latin1: Vec<u8> = text
        .chars()
        .take(MAX_CLIPBOARD_BYTES)
        .map(|c| {
            let code = c as u32;
            if code <= 0xff {
                code as u8
            } else {
                b'?'
            }
        })
        .collect();
    out.extend_from_slice(&[client_msg::CLIENT_CUT_TEXT, 0, 0, 0]);
    out.extend_from_slice(&(latin1.len() as u32).to_be_bytes());
    out.extend_from_slice(&latin1);
}

pub fn write_set_desktop_size(out: &mut Vec<u8>, width: u16, height: u16) {
    out.push(client_msg::SET_DESKTOP_SIZE);
    out.push(0);
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
    out.push(1); // 1 screen
    out.push(0);
    out.extend_from_slice(&0u32.to_be_bytes()); // screen id
    out.extend_from_slice(&0u16.to_be_bytes()); // x
    out.extend_from_slice(&0u16.to_be_bytes()); // y
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
    out.extend_from_slice(&0u32.to_be_bytes()); // flags
}
