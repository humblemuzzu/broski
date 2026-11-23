use crate::error::Result;
use crate::framebuffer::{Framebuffer, Rect};
use crate::wire::PixelFormat;

use crate::decode::{RectHeader, RectOutcome};

pub(super) fn decode_hextile(
    h: RectHeader,
    payload: &[u8],
    pf: PixelFormat,
    fb: &mut Framebuffer,
) -> Result<Option<(usize, RectOutcome)>> {
    fb.check_rect(h.x, h.y, h.width, h.height)?;
    let bpp = pf.bytes_per_pixel();
    let Some(total) = measure_hextile(h, payload, bpp) else {
        return Ok(None);
    };
    apply_hextile(h, &payload[..total], pf, bpp, fb);
    fb.mark_dirty(Rect {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
    });
    Ok(Some((total, RectOutcome::Pixels)))
}

fn measure_hextile(h: RectHeader, payload: &[u8], bpp: usize) -> Option<usize> {
    let mut pos = 0usize;
    let mut ty = 0u16;
    while ty < h.height {
        let th = (h.height - ty).min(16);
        let mut tx = 0u16;
        while tx < h.width {
            let tw = (h.width - tx).min(16);
            let mask = *payload.get(pos)?;
            pos += 1;
            if mask & 1 != 0 {
                pos += usize::from(tw) * usize::from(th) * bpp;
            } else {
                if mask & 2 != 0 {
                    pos += bpp;
                }
                if mask & 4 != 0 {
                    pos += bpp;
                }
                if mask & 8 != 0 {
                    let count = *payload.get(pos)?;
                    pos += 1;
                    let entry = if mask & 16 != 0 { bpp + 2 } else { 2 };
                    pos += usize::from(count) * entry;
                }
            }
            if payload.len() < pos {
                return None;
            }
            tx += tw;
        }
        ty += th;
    }
    Some(pos)
}

fn apply_hextile(h: RectHeader, payload: &[u8], pf: PixelFormat, bpp: usize, fb: &mut Framebuffer) {
    let mut pos = 0usize;
    let mut bg = [0u8; 4];
    let mut fg = [0u8; 4];
    let mut ty = 0u16;
    while ty < h.height {
        let th = (h.height - ty).min(16);
        let mut tx = 0u16;
        while tx < h.width {
            let tw = (h.width - tx).min(16);
            let mask = payload[pos];
            pos += 1;
            if mask & 1 != 0 {
                let raw_len = usize::from(tw) * usize::from(th) * bpp;
                fb.blit_raw(h.x + tx, h.y + ty, tw, th, pf, &payload[pos..pos + raw_len]);
                pos += raw_len;
            } else {
                if mask & 2 != 0 {
                    bg = pf.decode_pixel(&payload[pos..pos + bpp]);
                    pos += bpp;
                }
                fb.fill_rect(h.x + tx, h.y + ty, tw, th, bg);
                if mask & 4 != 0 {
                    fg = pf.decode_pixel(&payload[pos..pos + bpp]);
                    pos += bpp;
                }
                if mask & 8 != 0 {
                    let count = payload[pos];
                    pos += 1;
                    let coloured = mask & 16 != 0;
                    for _ in 0..count {
                        let color = if coloured {
                            let c = pf.decode_pixel(&payload[pos..pos + bpp]);
                            pos += bpp;
                            c
                        } else {
                            fg
                        };
                        let xy = payload[pos];
                        let wh = payload[pos + 1];
                        pos += 2;
                        let sx = u16::from(xy >> 4);
                        let sy = u16::from(xy & 0x0f);
                        let sw = u16::from((wh >> 4) + 1).min(tw.saturating_sub(sx));
                        let sh = u16::from((wh & 0x0f) + 1).min(th.saturating_sub(sy));
                        fb.fill_rect(h.x + tx + sx, h.y + ty + sy, sw, sh, color);
                    }
                }
            }
            tx += tw;
        }
        ty += th;
    }
}
