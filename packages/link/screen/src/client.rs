use std::collections::VecDeque;

use zeroize::Zeroize;

use crate::decode::{decode_rect, CursorShape, Decoders, RectHeader, RectOutcome};
use crate::error::{Error, Result};
use crate::framebuffer::{Framebuffer, Rect};
use crate::keys::{shortcut_events, text_events, ScreenShortcut};
use crate::wire::{
    enc, server_msg, write_client_cut_text, write_fb_update_request, write_key_event,
    write_pointer_event, write_set_desktop_size, PixelFormat, MAX_CLIPBOARD_BYTES,
    MAX_ZLIB_RECT_BYTES,
};

const MAX_RX_BUFFER: usize = 64 * 1024 * 1024;
pub(crate) const PREFERRED_ENCODINGS: &[i32] = &[
    enc::ZRLE,
    enc::ZLIB,
    enc::COPY_RECT,
    enc::HEXTILE,
    enc::RAW,
    enc::EXTENDED_DESKTOP_SIZE,
    enc::DESKTOP_SIZE,
    enc::RICH_CURSOR,
    enc::POINTER_POS,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthScheme {
    None,
    VncPassword,
    AppleCredentials,
}

#[derive(Clone, Default)]
pub struct ScreenCredentials {
    pub username: String,
    pub password: String,
}

impl Drop for ScreenCredentials {
    fn drop(&mut self) {
        self.username.zeroize();
        self.password.zeroize();
    }
}

impl std::fmt::Debug for ScreenCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScreenCredentials")
            .field("username", &self.username)
            .field("password", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScreenEvent {
    AuthRequired {
        schemes: Vec<AuthScheme>,
    },
    Ready {
        width: u16,
        height: u16,
        desktop_name: String,
        apple_server: bool,
    },
    Frame {
        width: u16,
        height: u16,
        rect: Rect,
        rgba: Vec<u8>,
    },
    Resized {
        width: u16,
        height: u16,
    },
    Cursor(CursorShape),
    PointerPos {
        x: u16,
        y: u16,
    },
    Clipboard(String),
}

pub(crate) enum State {
    Version,
    SecurityTypes,
    SecurityV33,
    WaitingCredentials { offered: Vec<u8> },
    VncChallenge,
    ArdChallenge,
    SecurityResult,
    SecurityFailReason { len: usize },
    ServerInit,
    Running(RunState),
}

pub(crate) struct RunState {
    pub(crate) fb: Framebuffer,
    pub(crate) pf: PixelFormat,
    pub(crate) decoders: Decoders,
    pub(crate) pending_rects: u16,
    pub(crate) resized_in_batch: bool,
    pub(crate) desktop_size_supported: bool,
}

/// Sans-IO RFB 3.8 + Apple Screen Sharing (`003.889`) client state machine.
pub struct Client {
    pub(crate) state: State,
    pub(crate) minor_version: u16,
    pub(crate) apple_server: bool,
    pub(crate) credentials: Option<ScreenCredentials>,
    pub(crate) rx: Vec<u8>,
    pub(crate) tx: Vec<u8>,
    pub(crate) events: VecDeque<ScreenEvent>,
}

impl Client {
    pub fn new(credentials: Option<ScreenCredentials>) -> Self {
        Self {
            state: State::Version,
            minor_version: 8,
            apple_server: false,
            credentials,
            rx: Vec::with_capacity(64 * 1024),
            tx: Vec::with_capacity(1024),
            events: VecDeque::new(),
        }
    }

    pub fn is_ready(&self) -> bool {
        matches!(self.state, State::Running(_))
    }

    pub fn snapshot_rgba(&self) -> Option<(u16, u16, &[u8])> {
        let State::Running(run) = &self.state else {
            return None;
        };
        Some((run.fb.width(), run.fb.height(), run.fb.pixels()))
    }

    pub fn poll_event(&mut self) -> Option<ScreenEvent> {
        self.events.pop_front()
    }

    pub fn poll_write(&mut self) -> Option<Vec<u8>> {
        if self.tx.is_empty() {
            return None;
        }
        Some(std::mem::take(&mut self.tx))
    }

    pub fn provide_credentials(&mut self, credentials: ScreenCredentials) -> Result<()> {
        let State::WaitingCredentials { offered } = &self.state else {
            return Err(Error::Protocol("credentials not requested".to_owned()));
        };
        let offered = offered.clone();
        self.credentials = Some(credentials);
        self.choose_security(&offered)?;
        self.step()
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Result<()> {
        if self.rx.len() + bytes.len() > MAX_RX_BUFFER {
            return Err(Error::Protocol("receive buffer exceeded 64 MiB".to_owned()));
        }
        self.rx.extend_from_slice(bytes);
        self.step()
    }

    pub fn send_pointer(&mut self, x: u16, y: u16, buttons: u8) {
        if let State::Running(run) = &self.state {
            let cx = x.min(run.fb.width().saturating_sub(1));
            let cy = y.min(run.fb.height().saturating_sub(1));
            write_pointer_event(&mut self.tx, cx, cy, buttons);
        }
    }

    pub fn send_scroll(&mut self, x: u16, y: u16, delta_x: i8, delta_y: i8) {
        if !self.is_ready() {
            return;
        }
        let emit_pulses = |this: &mut Self, bit: u8, count: i8| {
            for _ in 0..count.unsigned_abs().min(8) {
                this.send_pointer(x, y, bit);
                this.send_pointer(x, y, 0);
            }
        };
        if delta_y > 0 {
            emit_pulses(self, 1 << 3, delta_y);
        } else if delta_y < 0 {
            emit_pulses(self, 1 << 4, delta_y);
        }
        if delta_x > 0 {
            emit_pulses(self, 1 << 5, delta_x);
        } else if delta_x < 0 {
            emit_pulses(self, 1 << 6, delta_x);
        }
    }

    pub fn send_key(&mut self, keysym: u32, down: bool) {
        if self.is_ready() {
            write_key_event(&mut self.tx, keysym, down);
        }
    }

    pub fn type_text(&mut self, text: &str) {
        if !self.is_ready() {
            return;
        }
        for (sym, down) in text_events(text) {
            write_key_event(&mut self.tx, sym, down);
        }
    }

    pub fn send_shortcut(&mut self, shortcut: ScreenShortcut) {
        if !self.is_ready() {
            return;
        }
        for (sym, down) in shortcut_events(shortcut) {
            write_key_event(&mut self.tx, sym, down);
        }
    }

    pub fn set_clipboard(&mut self, text: &str) {
        if self.is_ready() {
            write_client_cut_text(&mut self.tx, text);
        }
    }

    pub fn request_desktop_size(&mut self, width: u16, height: u16) {
        if let State::Running(run) = &self.state {
            if run.desktop_size_supported && width >= 320 && height >= 320 {
                write_set_desktop_size(&mut self.tx, width, height);
            }
        }
    }

    pub fn request_full_refresh(&mut self) {
        if let State::Running(run) = &mut self.state {
            write_fb_update_request(&mut self.tx, false, 0, 0, run.fb.width(), run.fb.height());
        }
    }

    fn step(&mut self) -> Result<()> {
        loop {
            let progressed = match &self.state {
                State::Version => self.step_version()?,
                State::SecurityTypes => self.step_security_types()?,
                State::SecurityV33 => self.step_security_v33()?,
                State::WaitingCredentials { .. } => false,
                State::VncChallenge => self.step_vnc_challenge()?,
                State::ArdChallenge => self.step_ard_challenge()?,
                State::SecurityResult => self.step_security_result()?,
                State::SecurityFailReason { .. } => self.step_security_fail_reason()?,
                State::ServerInit => self.step_server_init()?,
                State::Running(_) => self.step_running()?,
            };
            if !progressed {
                return Ok(());
            }
        }
    }

    fn step_running(&mut self) -> Result<bool> {
        let State::Running(run) = &self.state else {
            return Ok(false);
        };
        if run.pending_rects > 0 {
            return self.step_pending_rect();
        }
        let Some(&msg) = self.rx.first() else {
            return Ok(false);
        };
        match msg {
            server_msg::FRAMEBUFFER_UPDATE => self.read_fb_update_header(),
            server_msg::SET_COLOUR_MAP_ENTRIES => self.skip_colour_map(),
            server_msg::BELL => {
                self.rx.drain(..1);
                Ok(true)
            }
            server_msg::SERVER_CUT_TEXT => self.read_server_cut_text(),
            other => Err(Error::Protocol(format!(
                "unknown RFB server message {other}"
            ))),
        }
    }

    fn read_fb_update_header(&mut self) -> Result<bool> {
        if self.rx.len() < 4 {
            return Ok(false);
        }
        let rects = u16::from_be_bytes([self.rx[2], self.rx[3]]);
        self.rx.drain(..4);
        if let State::Running(run) = &mut self.state {
            run.pending_rects = rects;
            run.resized_in_batch = false;
            if rects == 0 {
                finish_update(run, &mut self.tx, &mut self.events);
            }
        }
        Ok(true)
    }

    fn skip_colour_map(&mut self) -> Result<bool> {
        if self.rx.len() < 6 {
            return Ok(false);
        }
        let count = usize::from(u16::from_be_bytes([self.rx[4], self.rx[5]]));
        let need = 6 + count * 6;
        if self.rx.len() < need {
            return Ok(false);
        }
        self.rx.drain(..need);
        Ok(true)
    }

    fn read_server_cut_text(&mut self) -> Result<bool> {
        if self.rx.len() < 8 {
            return Ok(false);
        }
        let len = u32::from_be_bytes([self.rx[4], self.rx[5], self.rx[6], self.rx[7]]) as usize;
        if len > MAX_ZLIB_RECT_BYTES {
            return Err(Error::Protocol("clipboard payload too large".to_owned()));
        }
        if self.rx.len() < 8 + len {
            return Ok(false);
        }
        let raw = &self.rx[8..8 + len.min(MAX_CLIPBOARD_BYTES)];
        let text: String = raw.iter().map(|&b| char::from(b)).collect();
        self.rx.drain(..8 + len);
        self.events.push_back(ScreenEvent::Clipboard(text));
        Ok(true)
    }

    fn step_pending_rect(&mut self) -> Result<bool> {
        let State::Running(run) = &mut self.state else {
            return Ok(false);
        };
        let Some(header) = RectHeader::parse(&self.rx) else {
            return Ok(false);
        };
        if header.encoding == enc::EXTENDED_DESKTOP_SIZE {
            run.desktop_size_supported = true;
        }
        let Some((consumed, outcome)) = decode_rect(
            header,
            &self.rx[12..],
            run.pf,
            &mut run.fb,
            &mut run.decoders,
        )?
        else {
            return Ok(false);
        };
        self.rx.drain(..12 + consumed);
        match outcome {
            RectOutcome::Pixels | RectOutcome::Ignored => {}
            RectOutcome::Resized { width, height } => {
                run.resized_in_batch = true;
                self.events
                    .push_back(ScreenEvent::Resized { width, height });
            }
            RectOutcome::Cursor(shape) => self.events.push_back(ScreenEvent::Cursor(shape)),
            RectOutcome::PointerPos { x, y } => {
                self.events.push_back(ScreenEvent::PointerPos { x, y });
            }
        }
        run.pending_rects -= 1;
        if run.pending_rects == 0 {
            finish_update(run, &mut self.tx, &mut self.events);
        }
        Ok(true)
    }
}

fn finish_update(run: &mut RunState, tx: &mut Vec<u8>, events: &mut VecDeque<ScreenEvent>) {
    if let Some((rect, rgba)) = run.fb.take_dirty_rgba() {
        events.push_back(ScreenEvent::Frame {
            width: run.fb.width(),
            height: run.fb.height(),
            rect,
            rgba,
        });
    }
    let incremental = !run.resized_in_batch;
    write_fb_update_request(tx, incremental, 0, 0, run.fb.width(), run.fb.height());
}
