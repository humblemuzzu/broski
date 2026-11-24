/// X11 keysyms used by RFB `KeyEvent` and macOS `screensharingd`.
pub mod keysym {
    pub const BACKSPACE: u32 = 0xff08;
    pub const TAB: u32 = 0xff09;
    pub const RETURN: u32 = 0xff0d;
    pub const ESCAPE: u32 = 0xff1b;
    pub const DELETE: u32 = 0xffff;
    pub const HOME: u32 = 0xff50;
    pub const LEFT: u32 = 0xff51;
    pub const UP: u32 = 0xff52;
    pub const RIGHT: u32 = 0xff53;
    pub const DOWN: u32 = 0xff54;
    pub const PAGE_UP: u32 = 0xff55;
    pub const PAGE_DOWN: u32 = 0xff56;
    pub const END: u32 = 0xff57;
    pub const SPACE: u32 = 0x0020;

    pub const SHIFT_L: u32 = 0xffe1;
    pub const CONTROL_L: u32 = 0xffe3;
    pub const META_L: u32 = 0xffe7;
    pub const ALT_L: u32 = 0xffe9;
    pub const SUPER_L: u32 = 0xffeb;
}

/// High-level Mac actions exposed cleanly to the phone toolbar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

/// Converts a single Unicode scalar into its X11 keysym (RFC 6143 + X11 Unicode range).
///
/// Sending resolved keysyms directly (e.g. `'@'` as `0x0040`, not Shift + `'2'`) avoids the
/// macOS login-window shifted-keysym bug where synthesized Shift + base keys drop symbols.
pub fn char_to_keysym(ch: char) -> Option<u32> {
    match ch {
        '\n' | '\r' => Some(keysym::RETURN),
        '\t' => Some(keysym::TAB),
        '\x08' => Some(keysym::BACKSPACE),
        '\x1b' => Some(keysym::ESCAPE),
        '\x7f' => Some(keysym::DELETE),
        c if (0x0020..=0x007e).contains(&(c as u32)) => Some(c as u32),
        c if (0x00a0..=0x00ff).contains(&(c as u32)) => Some(c as u32),
        c if (c as u32) >= 0x0100 => Some(0x0100_0000 | (c as u32)),
        _ => None,
    }
}

/// Returns `(keysym, down)` pairs for a high-level macOS shortcut.
pub fn shortcut_events(shortcut: ScreenShortcut) -> Vec<(u32, bool)> {
    match shortcut {
        ScreenShortcut::MissionControl => chord(&[keysym::CONTROL_L], keysym::UP),
        ScreenShortcut::SpaceLeft => chord(&[keysym::CONTROL_L], keysym::LEFT),
        ScreenShortcut::SpaceRight => chord(&[keysym::CONTROL_L], keysym::RIGHT),
        ScreenShortcut::SwitchDesktop { index } => {
            let digit = match index {
                1..=9 => u32::from(b'0' + index),
                _ => return Vec::new(),
            };
            chord(&[keysym::CONTROL_L], digit)
        }
        ScreenShortcut::Copy => chord(&[keysym::SUPER_L], u32::from(b'c')),
        ScreenShortcut::Paste => chord(&[keysym::SUPER_L], u32::from(b'v')),
        ScreenShortcut::SelectAll => chord(&[keysym::SUPER_L], u32::from(b'a')),
        ScreenShortcut::Undo => chord(&[keysym::SUPER_L], u32::from(b'z')),
        ScreenShortcut::Spotlight => chord(&[keysym::SUPER_L], keysym::SPACE),
        ScreenShortcut::ForceQuit => chord(&[keysym::SUPER_L, keysym::ALT_L], keysym::ESCAPE),
        ScreenShortcut::Escape => tap(keysym::ESCAPE),
        ScreenShortcut::Return => tap(keysym::RETURN),
        ScreenShortcut::Tab => tap(keysym::TAB),
    }
}

/// Returns `(keysym, down)` pairs to type a text string verbatim (used for password entry).
pub fn text_events(text: &str) -> Vec<(u32, bool)> {
    let mut events = Vec::with_capacity(text.len().saturating_mul(2));
    for ch in text.chars() {
        if let Some(sym) = char_to_keysym(ch) {
            events.push((sym, true));
            events.push((sym, false));
        }
    }
    events
}

fn tap(sym: u32) -> Vec<(u32, bool)> {
    vec![(sym, true), (sym, false)]
}

fn chord(modifiers: &[u32], key: u32) -> Vec<(u32, bool)> {
    let mut out = Vec::with_capacity(modifiers.len() * 2 + 2);
    for &m in modifiers {
        out.push((m, true));
    }
    out.push((key, true));
    out.push((key, false));
    for &m in modifiers.iter().rev() {
        out.push((m, false));
    }
    out
}
