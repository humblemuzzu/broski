use crate::error::{Error, Result};
use crate::wire::{PixelFormat, MAX_HEIGHT, MAX_WIDTH};

/// Dirty bounding rectangle inside the framebuffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

impl Rect {
    pub fn union(self, other: Rect) -> Rect {
        let x0 = self.x.min(other.x);
        let y0 = self.y.min(other.y);
        let x1 = self
            .x
            .saturating_add(self.width)
            .max(other.x.saturating_add(other.width));
        let y1 = self
            .y
            .saturating_add(self.height)
            .max(other.y.saturating_add(other.height));
        Rect {
            x: x0,
            y: y0,
            width: x1.saturating_sub(x0),
            height: y1.saturating_sub(y0),
        }
    }
}

/// Bounded RGBA8888 desktop framebuffer with dirty-region tracking.
pub struct Framebuffer {
    width: u16,
    height: u16,
    pixels: Vec<u8>,
    dirty: Option<Rect>,
}

impl Framebuffer {
    pub fn new(width: u16, height: u16) -> Result<Self> {
        validate_dims(width, height)?;
        let len = usize::from(width) * usize::from(height) * 4;
        Ok(Self {
            width,
            height,
            pixels: vec![0u8; len],
            dirty: None,
        })
    }

    pub fn resize(&mut self, width: u16, height: u16) -> Result<()> {
        validate_dims(width, height)?;
        self.width = width;
        self.height = height;
        self.pixels
            .resize(usize::from(width) * usize::from(height) * 4, 0);
        self.pixels.fill(0);
        self.dirty = Some(Rect {
            x: 0,
            y: 0,
            width,
            height,
        });
        Ok(())
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }

    pub fn check_rect(&self, x: u16, y: u16, w: u16, h: u16) -> Result<()> {
        let end_x = u32::from(x) + u32::from(w);
        let end_y = u32::from(y) + u32::from(h);
        if end_x > u32::from(self.width) || end_y > u32::from(self.height) {
            return Err(Error::Protocol(format!(
                "rect {x},{y} {w}x{h} out of bounds {}x{}",
                self.width, self.height
            )));
        }
        Ok(())
    }

    pub fn mark_dirty(&mut self, rect: Rect) {
        if rect.width == 0 || rect.height == 0 {
            return;
        }
        self.dirty = Some(match self.dirty {
            Some(existing) => existing.union(rect),
            None => rect,
        });
    }

    pub fn take_dirty_rgba(&mut self) -> Option<(Rect, Vec<u8>)> {
        let rect = self.dirty.take()?;
        let row_bytes = usize::from(rect.width) * 4;
        let stride = usize::from(self.width) * 4;
        let mut out = Vec::with_capacity(row_bytes * usize::from(rect.height));
        for row in 0..usize::from(rect.height) {
            let start = (usize::from(rect.y) + row) * stride + usize::from(rect.x) * 4;
            out.extend_from_slice(&self.pixels[start..start + row_bytes]);
        }
        Some((rect, out))
    }

    pub fn set_pixel(&mut self, x: u16, y: u16, rgba: [u8; 4]) {
        let idx = (usize::from(y) * usize::from(self.width) + usize::from(x)) * 4;
        self.pixels[idx..idx + 4].copy_from_slice(&rgba);
    }

    pub fn fill_rect(&mut self, x: u16, y: u16, w: u16, h: u16, rgba: [u8; 4]) {
        let stride = usize::from(self.width) * 4;
        for dy in 0..usize::from(h) {
            let row = (usize::from(y) + dy) * stride + usize::from(x) * 4;
            for dx in 0..usize::from(w) {
                let idx = row + dx * 4;
                self.pixels[idx..idx + 4].copy_from_slice(&rgba);
            }
        }
    }

    pub fn blit_raw(&mut self, x: u16, y: u16, w: u16, h: u16, pf: PixelFormat, raw: &[u8]) {
        let bpp = pf.bytes_per_pixel();
        let stride = usize::from(self.width) * 4;
        let fast_rgba = pf == PixelFormat::RGBA8888;
        let mut src = 0;
        for dy in 0..usize::from(h) {
            let row = (usize::from(y) + dy) * stride + usize::from(x) * 4;
            if fast_rgba {
                let row_len = usize::from(w) * 4;
                self.pixels[row..row + row_len].copy_from_slice(&raw[src..src + row_len]);
                for px in self.pixels[row..row + row_len].as_chunks_mut::<4>().0 {
                    px[3] = 255;
                }
                src += row_len;
            } else {
                for dx in 0..usize::from(w) {
                    let rgba = pf.decode_pixel(&raw[src..src + bpp]);
                    let idx = row + dx * 4;
                    self.pixels[idx..idx + 4].copy_from_slice(&rgba);
                    src += bpp;
                }
            }
        }
    }

    pub fn copy_rect(
        &mut self,
        src_x: u16,
        src_y: u16,
        dst_x: u16,
        dst_y: u16,
        w: u16,
        h: u16,
    ) -> Result<()> {
        self.check_rect(src_x, src_y, w, h)?;
        self.check_rect(dst_x, dst_y, w, h)?;
        let row_bytes = usize::from(w) * 4;
        let stride = usize::from(self.width) * 4;
        let mut scratch = Vec::with_capacity(row_bytes * usize::from(h));
        for dy in 0..usize::from(h) {
            let start = (usize::from(src_y) + dy) * stride + usize::from(src_x) * 4;
            scratch.extend_from_slice(&self.pixels[start..start + row_bytes]);
        }
        for dy in 0..usize::from(h) {
            let dst = (usize::from(dst_y) + dy) * stride + usize::from(dst_x) * 4;
            let src = dy * row_bytes;
            self.pixels[dst..dst + row_bytes].copy_from_slice(&scratch[src..src + row_bytes]);
        }
        Ok(())
    }
}

fn validate_dims(width: u16, height: u16) -> Result<()> {
    if width == 0 || height == 0 || width > MAX_WIDTH || height > MAX_HEIGHT {
        return Err(Error::InvalidDimensions { width, height });
    }
    Ok(())
}
