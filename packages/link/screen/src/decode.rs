use miniz_oxide::inflate::stream::{inflate, InflateState};
use miniz_oxide::{DataFormat, MZError, MZFlush, MZStatus};

use crate::decode_hextile::decode_hextile;
use crate::decode_zrle::apply_zrle_tiles;
use crate::error::{Error, Result};
use crate::framebuffer::{Framebuffer, Rect};
use crate::wire::{enc, PixelFormat, MAX_ZLIB_RECT_BYTES};

/// Persistent streaming zlib decompressors (RFC 6143 keeps one zlib stream per encoding per conn).
pub struct Decoders {
    zlib: Box<InflateState>,
    zrle: Box<InflateState>,
}

impl Default for Decoders {
    fn default() -> Self {
        Self {
            zlib: InflateState::new_boxed(DataFormat::Zlib),
            zrle: InflateState::new_boxed(DataFormat::Zlib),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorShape {
    pub width: u16,
    pub height: u16,
    pub hotspot_x: u16,
    pub hotspot_y: u16,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RectOutcome {
    Pixels,
    Resized { width: u16, height: u16 },
    Cursor(CursorShape),
    PointerPos { x: u16, y: u16 },
    Ignored,
}

#[derive(Debug, Clone, Copy)]
pub struct RectHeader {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub encoding: i32,
}

impl RectHeader {
    pub fn parse(buf: &[u8]) -> Option<Self> {
        if buf.len() < 12 {
            return None;
        }
        Some(Self {
            x: u16::from_be_bytes([buf[0], buf[1]]),
            y: u16::from_be_bytes([buf[2], buf[3]]),
            width: u16::from_be_bytes([buf[4], buf[5]]),
            height: u16::from_be_bytes([buf[6], buf[7]]),
            encoding: i32::from_be_bytes([buf[8], buf[9], buf[10], buf[11]]),
        })
    }
}

/// Attempts to decode one rectangle payload starting at `payload`.
/// Returns `Ok(None)` when more bytes are required before the rectangle is complete.
pub fn decode_rect(
    header: RectHeader,
    payload: &[u8],
    pf: PixelFormat,
    fb: &mut Framebuffer,
    decoders: &mut Decoders,
) -> Result<Option<(usize, RectOutcome)>> {
    match header.encoding {
        enc::RAW => decode_raw(header, payload, pf, fb),
        enc::COPY_RECT => decode_copy_rect(header, payload, fb),
        enc::HEXTILE => decode_hextile(header, payload, pf, fb),
        enc::ZLIB => decode_zlib(header, payload, pf, fb, &mut decoders.zlib),
        enc::ZRLE => decode_zrle(header, payload, pf, fb, &mut decoders.zrle),
        enc::DESKTOP_SIZE => {
            fb.resize(header.width, header.height)?;
            Ok(Some((
                0,
                RectOutcome::Resized {
                    width: header.width,
                    height: header.height,
                },
            )))
        }
        enc::EXTENDED_DESKTOP_SIZE => decode_extended_desktop_size(header, payload, fb),
        enc::RICH_CURSOR => decode_rich_cursor(header, payload, pf),
        enc::POINTER_POS => Ok(Some((
            0,
            RectOutcome::PointerPos {
                x: header.x,
                y: header.y,
            },
        ))),
        other => Err(Error::UnsupportedEncoding(other)),
    }
}

fn decode_raw(
    h: RectHeader,
    payload: &[u8],
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<Option<(usize, RectOutcome)>> {
    fb.check_rect(h.x, h.y, h.width, h.height)?;
    let need = usize::from(h.width) * usize::from(h.height) * pf.bytes_per_pixel();
    if payload.len() < need {
        return Ok(None);
    }
    fb.blit_raw(h.x, h.y, h.width, h.height, pf, &payload[..need]);
    fb.mark_dirty(Rect {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
    });
    Ok(Some((need, RectOutcome::Pixels)))
}

fn decode_copy_rect(
    h: RectHeader,
    payload: &[u8],
    fb: &mut Framebuffer,
) -> Result<Option<(usize, RectOutcome)>> {
    if payload.len() < 4 {
        return Ok(None);
    }
    let src_x = u16::from_be_bytes([payload[0], payload[1]]);
    let src_y = u16::from_be_bytes([payload[2], payload[3]]);
    fb.copy_rect(src_x, src_y, h.x, h.y, h.width, h.height)?;
    fb.mark_dirty(Rect {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
    });
    Ok(Some((4, RectOutcome::Pixels)))
}

fn decode_zlib(
    h: RectHeader,
    payload: &[u8],
    pf: PixelFormat,
    fb: &mut Framebuffer,
    state: &mut InflateState,
) -> Result<Option<(usize, RectOutcome)>> {
    fb.check_rect(h.x, h.y, h.width, h.height)?;
    let Some((consumed, compressed)) = read_u32_framed(payload)? else {
        return Ok(None);
    };
    let expected = usize::from(h.width) * usize::from(h.height) * pf.bytes_per_pixel();
    let raw = inflate_exact(state, compressed, expected)?;
    fb.blit_raw(h.x, h.y, h.width, h.height, pf, &raw);
    fb.mark_dirty(Rect {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
    });
    Ok(Some((consumed, RectOutcome::Pixels)))
}

fn decode_zrle(
    h: RectHeader,
    payload: &[u8],
    pf: PixelFormat,
    fb: &mut Framebuffer,
    state: &mut InflateState,
) -> Result<Option<(usize, RectOutcome)>> {
    fb.check_rect(h.x, h.y, h.width, h.height)?;
    let Some((consumed, compressed)) = read_u32_framed(payload)? else {
        return Ok(None);
    };
    let tiles = usize::from(h.width).div_ceil(64) * usize::from(h.height).div_ceil(64);
    let max_out = tiles
        .saturating_mul(1 + 16 * pf.cpixel_bytes())
        .saturating_add(
            usize::from(h.width)
                .saturating_mul(usize::from(h.height))
                .saturating_mul(pf.cpixel_bytes() + 1),
        )
        .min(MAX_ZLIB_RECT_BYTES);
    let data = inflate_chunk(state, compressed, max_out)?;
    apply_zrle_tiles(h, &data, pf, fb)?;
    fb.mark_dirty(Rect {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
    });
    Ok(Some((consumed, RectOutcome::Pixels)))
}

fn decode_extended_desktop_size(
    h: RectHeader,
    payload: &[u8],
    fb: &mut Framebuffer,
) -> Result<Option<(usize, RectOutcome)>> {
    if payload.len() < 4 {
        return Ok(None);
    }
    let num_screens = usize::from(payload[0]);
    let need = 4 + num_screens * 16;
    if payload.len() < need {
        return Ok(None);
    }
    if h.width > 0 && h.height > 0 && (h.width != fb.width() || h.height != fb.height()) {
        fb.resize(h.width, h.height)?;
        return Ok(Some((
            need,
            RectOutcome::Resized {
                width: h.width,
                height: h.height,
            },
        )));
    }
    Ok(Some((need, RectOutcome::Ignored)))
}

fn decode_rich_cursor(
    h: RectHeader,
    payload: &[u8],
    pf: PixelFormat,
) -> Result<Option<(usize, RectOutcome)>> {
    if h.width == 0 || h.height == 0 {
        return Ok(Some((
            0,
            RectOutcome::Cursor(CursorShape {
                width: 0,
                height: 0,
                hotspot_x: 0,
                hotspot_y: 0,
                rgba: Vec::new(),
            }),
        )));
    }
    if h.width > 256 || h.height > 256 {
        return Err(Error::Protocol("cursor exceeds 256x256".to_owned()));
    }
    let bpp = pf.bytes_per_pixel();
    let px_bytes = usize::from(h.width) * usize::from(h.height) * bpp;
    let mask_stride = usize::from(h.width).div_ceil(8);
    let need = px_bytes + mask_stride * usize::from(h.height);
    if payload.len() < need {
        return Ok(None);
    }
    let mask = &payload[px_bytes..need];
    let mut rgba = Vec::with_capacity(usize::from(h.width) * usize::from(h.height) * 4);
    for dy in 0..usize::from(h.height) {
        for dx in 0..usize::from(h.width) {
            let src = (dy * usize::from(h.width) + dx) * bpp;
            let bit = (mask[dy * mask_stride + dx / 8] >> (7 - (dx % 8))) & 1;
            let px = if bit != 0 {
                pf.decode_pixel(&payload[src..src + bpp])
            } else {
                [0, 0, 0, 0]
            };
            rgba.extend_from_slice(&px);
        }
    }
    Ok(Some((
        need,
        RectOutcome::Cursor(CursorShape {
            width: h.width,
            height: h.height,
            hotspot_x: h.x,
            hotspot_y: h.y,
            rgba,
        }),
    )))
}

fn read_u32_framed(payload: &[u8]) -> Result<Option<(usize, &[u8])>> {
    if payload.len() < 4 {
        return Ok(None);
    }
    let len = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
    if len > MAX_ZLIB_RECT_BYTES {
        return Err(Error::Decompress(format!(
            "compressed rect too large: {len}"
        )));
    }
    if payload.len() < 4 + len {
        return Ok(None);
    }
    Ok(Some((4 + len, &payload[4..4 + len])))
}

fn inflate_exact(state: &mut InflateState, input: &[u8], expected: usize) -> Result<Vec<u8>> {
    let out = inflate_chunk(state, input, expected)?;
    if out.len() != expected {
        return Err(Error::Decompress(format!(
            "zlib length mismatch: got {}, expected {expected}",
            out.len()
        )));
    }
    Ok(out)
}

fn inflate_chunk(state: &mut InflateState, input: &[u8], max_out: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(max_out.min(64 * 1024));
    let mut scratch = vec![0u8; 32 * 1024];
    let mut in_pos = 0usize;
    loop {
        let res = inflate(state, &input[in_pos..], &mut scratch, MZFlush::Sync);
        in_pos += res.bytes_consumed;
        if res.bytes_written > 0 {
            if out.len() + res.bytes_written > max_out {
                return Err(Error::Decompress("zlib output exceeded limit".to_owned()));
            }
            out.extend_from_slice(&scratch[..res.bytes_written]);
        }
        match res.status {
            Ok(MZStatus::StreamEnd) => break,
            Ok(MZStatus::Ok) => {
                if in_pos >= input.len() && res.bytes_written < scratch.len() {
                    break;
                }
                if res.bytes_consumed == 0 && res.bytes_written == 0 {
                    return Err(Error::Decompress("zlib made no progress".to_owned()));
                }
            }
            Ok(MZStatus::NeedDict) => {
                return Err(Error::Decompress(
                    "unexpected zlib preset dictionary".to_owned(),
                ));
            }
            Err(MZError::Buf) if in_pos >= input.len() && res.bytes_written == 0 => break,
            Err(status) => {
                return Err(Error::Decompress(format!("miniz_oxide error: {status:?}")));
            }
        }
    }
    Ok(out)
}
