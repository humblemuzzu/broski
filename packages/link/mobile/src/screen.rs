//! UniFFI exports for remote Mac screen viewing and on-screen macOS dialog alerts.

use std::sync::Arc;

use broski_client as client;
use broski_client::{
    AuthScheme, ClientError, MacDialog, ScreenCloseReason, ScreenShortcut, ScreenUpdate,
};

#[uniffi::remote(Record)]
pub struct MacDialog {
    pub id: String,
    pub kind: String,
    pub owner: String,
    pub title: String,
}

#[derive(uniffi::Record)]
pub struct ScreenCredentials {
    pub username: String,
    pub password: String,
}

impl ScreenCredentials {
    pub(crate) fn into_core(self) -> broski_client::ScreenCredentials {
        broski_client::ScreenCredentials {
            username: self.username,
            password: self.password,
        }
    }
}

#[uniffi::remote(Enum)]
pub enum AuthScheme {
    None,
    VncPassword,
    AppleCredentials,
}

#[uniffi::remote(Enum)]
pub enum ScreenCloseReason {
    Normal,
    ScreenSharingDisabled,
    Unavailable,
    AuthFailed,
    ProtocolError,
    LinkReset,
}

#[uniffi::remote(Enum)]
pub enum ScreenShortcut {
    MissionControl,
    SpaceLeft,
    SpaceRight,
    SwitchDesktop { index: u8 },
    Copy,
    Paste,
    SelectAll,
    Undo,
    Spotlight,
    ForceQuit,
    Escape,
    Return,
    Tab,
}

#[uniffi::remote(Enum)]
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

/// A live remote screen stream for one paired Mac, pulled via `next_update`.
#[derive(uniffi::Object)]
pub struct ScreenView(pub(crate) Arc<client::ScreenView>);

#[uniffi::export]
impl ScreenView {
    pub async fn next_update(&self) -> Option<ScreenUpdate> {
        self.0.next_update().await
    }

    pub fn provide_credentials(&self, credentials: ScreenCredentials) -> Result<(), ClientError> {
        self.0.provide_credentials(credentials.into_core())
    }

    pub fn pointer(&self, x: u16, y: u16, buttons: u8) {
        self.0.pointer(x, y, buttons);
    }

    pub fn scroll(&self, x: u16, y: u16, delta_x: i8, delta_y: i8) {
        self.0.scroll(x, y, delta_x, delta_y);
    }

    pub fn key(&self, keysym: u32, down: bool) {
        self.0.key(keysym, down);
    }

    pub fn type_text(&self, text: String) {
        self.0.type_text(text);
    }

    pub fn shortcut(&self, shortcut: ScreenShortcut) {
        self.0.shortcut(shortcut);
    }

    pub fn request_desktop_size(&self, width: u16, height: u16) {
        self.0.request_desktop_size(width, height);
    }

    pub fn set_clipboard(&self, text: String) {
        self.0.set_clipboard(text);
    }

    pub fn refresh(&self) {
        self.0.refresh();
    }

    pub fn detach(&self) {
        self.0.close();
    }
}
