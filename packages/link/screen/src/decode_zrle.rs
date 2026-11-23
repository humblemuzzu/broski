use crate::error::{Error, Result};
use crate::framebuffer::Framebuffer;
use crate::wire::PixelFormat;

use crate::decode::RectHeader;

pub(super) fn apply_zrle_tiles(
    h: RectHeader,
    data: &[u8],
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<()> {
    let mut pos = 0usize;
    let mut ty = 0u16;
    while ty < h.height {
        let th = (h.height - ty).min(64);
        let mut tx = 0u16;
        while tx < h.width {
            let tw = (h.width - tx).min(64);
            decode_tile(data, &mut pos, h.x + tx, h.y + ty, tw, th, pf, fb)?;
            tx += tw;
        }
        ty += th;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn decode_tile(
    data: &[u8],
    pos: &mut usize,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<()> {
    let sub = *data
        .get(*pos)
        .ok_or_else(|| Error::Protocol("truncated ZRLE tile header".to_owned()))?;
    *pos += 1;
    let cbytes = pf.cpixel_bytes();
    match sub {
        0 => {
            for dy in 0..h {
                for dx in 0..w {
                    let px = read_cpixel(data, pos, pf, cbytes)?;
                    fb.set_pixel(x + dx, y + dy, px);
                }
            }
        }
        1 => {
            let px = read_cpixel(data, pos, pf, cbytes)?;
            fb.fill_rect(x, y, w, h, px);
        }
        2..=16 => decode_packed_palette(data, pos, x, y, w, h, usize::from(sub), pf, fb)?,
        128 => decode_plain_rle(data, pos, x, y, w, h, pf, fb)?,
        130..=255 => decode_palette_rle(data, pos, x, y, w, h, usize::from(sub - 128), pf, fb)?,
        other => {
            return Err(Error::Protocol(format!("invalid ZRLE subencoding {other}")));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn decode_packed_palette(
    data: &[u8],
    pos: &mut usize,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    palette_size: usize,
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<()> {
    let cbytes = pf.cpixel_bytes();
    let palette = read_palette(data, pos, palette_size, pf, cbytes)?;
    let bits: u8 = match palette_size {
        2 => 1,
        3..=4 => 2,
        _ => 4,
    };
    let mask = (1u8 << bits) - 1;
    for dy in 0..h {
        let mut cur_byte = 0u8;
        let mut bits_left = 0u8;
        for dx in 0..w {
            if bits_left == 0 {
                cur_byte = *data
                    .get(*pos)
                    .ok_or_else(|| Error::Protocol("truncated ZRLE packed palette".to_owned()))?;
                *pos += 1;
                bits_left = 8;
            }
            bits_left -= bits;
            let idx = usize::from((cur_byte >> bits_left) & mask);
            let px = *palette
                .get(idx)
                .ok_or_else(|| Error::Protocol("ZRLE palette index out of range".to_owned()))?;
            fb.set_pixel(x + dx, y + dy, px);
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn decode_plain_rle(
    data: &[u8],
    pos: &mut usize,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<()> {
    let cbytes = pf.cpixel_bytes();
    let total = usize::from(w) * usize::from(h);
    let mut written = 0usize;
    while written < total {
        let px = read_cpixel(data, pos, pf, cbytes)?;
        let run = read_rle_length(data, pos)?;
        if written + run > total {
            return Err(Error::Protocol("ZRLE plain RLE overflow".to_owned()));
        }
        write_tile_run(fb, x, y, w, written, run, px);
        written += run;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn decode_palette_rle(
    data: &[u8],
    pos: &mut usize,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    palette_size: usize,
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<()> {
    let cbytes = pf.cpixel_bytes();
    let palette = read_palette(data, pos, palette_size, pf, cbytes)?;
    let total = usize::from(w) * usize::from(h);
    let mut written = 0usize;
    while written < total {
        let tag = *data
            .get(*pos)
            .ok_or_else(|| Error::Protocol("truncated ZRLE palette RLE".to_owned()))?;
        *pos += 1;
        let idx = usize::from(tag & 0x7f);
        let px = *palette
            .get(idx)
            .ok_or_else(|| Error::Protocol("ZRLE palette RLE index out of range".to_owned()))?;
        let run = if tag & 0x80 != 0 {
            read_rle_length(data, pos)?
        } else {
            1
        };
        if written + run > total {
            return Err(Error::Protocol("ZRLE palette RLE overflow".to_owned()));
        }
        write_tile_run(fb, x, y, w, written, run, px);
        written += run;
    }
    Ok(())
}

fn write_tile_run(
    fb: &mut Framebuffer,
    x: u16,
    y: u16,
    w: u16,
    start: usize,
    run: usize,
    px: [u8; 4],
) {
    let w_usize = usize::from(w);
    for i in start..start + run {
        let dx = (i % w_usize) as u16;
        let dy = (i / w_usize) as u16;
        fb.set_pixel(x + dx, y + dy, px);
    }
}

fn read_rle_length(data: &[u8], pos: &mut usize) -> Result<usize> {
    let mut len = 1usize;
    loop {
        let b = *data
            .get(*pos)
            .ok_or_else(|| Error::Protocol("truncated ZRLE run length".to_owned()))?;
        *pos += 1;
        len += usize::from(b);
        if b != 255 {
            return Ok(len);
        }
    }
}

fn read_palette(
    data: &[u8],
    pos: &mut usize,
    size: usize,
    pf: PixelFormat,
    cbytes: usize,
) -> Result<Vec<[u8; 4]>> {
    let mut palette = Vec::with_capacity(size);
    for _ in 0..size {
        palette.push(read_cpixel(data, pos, pf, cbytes)?);
    }
    Ok(palette)
}

fn read_cpixel(data: &[u8], pos: &mut usize, pf: PixelFormat, cbytes: usize) -> Result<[u8; 4]> {
    let slice = data
        .get(*pos..*pos + cbytes)
        .ok_or_else(|| Error::Protocol("truncated ZRLE pixel".to_owned()))?;
    *pos += cbytes;
    Ok(pf.decode_pixel(slice))
}
