//! Live remote screen view over `STREAM_SCREEN` (RFB 3.8 + Apple Screen Sharing `003.889`).

pub(crate) mod state;

use std::sync::Arc;

use broski_screen::{AuthScheme, ScreenCloseReason, ScreenCredentials, ScreenShortcut};
use zeroize::Zeroize;

use self::state::TakeScreen;
use crate::error::ClientError;
use crate::machine::Machine;
use crate::wait;

/// Updates delivered to the phone's screen viewer, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScreenUpdate {
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
        x: u16,
        y: u16,
        rect_width: u16,
        rect_height: u16,
        rgba: Vec<u8>,
    },
    Resized {
        width: u16,
        height: u16,
    },
    Cursor {
        width: u16,
        height: u16,
        hotspot_x: u16,
        hotspot_y: u16,
        rgba: Vec<u8>,
    },
    PointerPos {
        x: u16,
        y: u16,
    },
    Clipboard {
        text: String,
    },
    Closed {
        reason: ScreenCloseReason,
        detail: String,
    },
}

/// One live remote screen view of a paired Mac. Opening another replaces this one.
pub struct ScreenView {
    machine: Arc<Machine>,
    session_id: u32,
}

impl ScreenView {
    pub(crate) fn new(machine: Arc<Machine>, session_id: u32) -> Self {
        Self {
            machine,
            session_id,
        }
    }

    pub async fn next_update(&self) -> Option<ScreenUpdate> {
        loop {
            let take = self.machine.shared().lock().screen.take(self.session_id);
            match take {
                TakeScreen::Update(update) => return Some(update),
                TakeScreen::Finished => return None,
                TakeScreen::Wait(notify) => {
                    wait::notified(self.machine.shared().runtime(), &notify, None).await;
                }
            }
        }
    }

    pub fn provide_credentials(&self, credentials: ScreenCredentials) -> Result<(), ClientError> {
        let frames = self
            .machine
            .shared()
            .lock()
            .screen
            .with_client(self.session_id, |c| c.provide_credentials(credentials))
            .map_err(|()| ClientError::Closed)?;
        self.send_frames(frames)
    }

    pub fn pointer(&self, x: u16, y: u16, buttons: u8) {
        self.send_action(|c| c.send_pointer(x, y, buttons));
    }

    pub fn scroll(&self, x: u16, y: u16, delta_x: i8, delta_y: i8) {
        self.send_action(|c| c.send_scroll(x, y, delta_x, delta_y));
    }

    pub fn key(&self, keysym: u32, down: bool) {
        self.send_action(|c| c.send_key(keysym, down));
    }

    pub fn type_text(&self, mut text: String) {
        let res = self
            .machine
            .shared()
            .lock()
            .screen
            .with_client(self.session_id, |c| {
                c.type_text(&text);
                Ok(())
            });
        text.zeroize();
        if let Ok(frames) = res {
            self.send_or_fail(frames);
        }
    }

    pub fn shortcut(&self, shortcut: ScreenShortcut) {
        self.send_action(|c| c.send_shortcut(shortcut));
    }

    pub fn request_desktop_size(&self, width: u16, height: u16) {
        self.send_action(|c| c.request_desktop_size(width, height));
    }

    pub fn set_clipboard(&self, text: String) {
        self.send_action(|c| c.set_clipboard(&text));
    }

    pub fn refresh(&self) {
        self.send_action(|c| c.request_full_refresh());
    }

    pub fn close(&self) {
        let close = self
            .machine
            .shared()
            .lock()
            .screen
            .close_id(self.session_id);
        if let Some(frame) = close {
            let _ = self.machine.shared().session().send_screen(frame);
        }
    }

    fn send_action(&self, f: impl FnOnce(&mut broski_screen::Client)) {
        if let Ok(frames) = self
            .machine
            .shared()
            .lock()
            .screen
            .with_client(self.session_id, |c| {
                f(c);
                Ok(())
            })
        {
            self.send_or_fail(frames);
        }
    }

    fn send_or_fail(&self, frames: Vec<Vec<u8>>) {
        if let Err(err) = self.send_frames(frames) {
            let close = self.machine.shared().lock().screen.fail_id(
                self.session_id,
                ScreenCloseReason::ProtocolError,
                err.to_string(),
            );
            if let Some(frame) = close {
                let _ = self.machine.shared().session().send_screen(frame);
            }
        }
    }

    fn send_frames(&self, frames: Vec<Vec<u8>>) -> Result<(), ClientError> {
        for frame in frames {
            self.machine
                .shared()
                .session()
                .send_screen(frame)
                .map_err(|failure| ClientError::NotSent { failure })?;
        }
        Ok(())
    }
}

impl Drop for ScreenView {
    fn drop(&mut self) {
        self.close();
    }
}
