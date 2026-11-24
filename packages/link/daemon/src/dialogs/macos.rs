use std::ffi::c_void;

use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType};

use super::MacDialog;

const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
const K_CG_NULL_WINDOW_ID: u32 = 0;
const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> *const c_void;
}

extern "C" {
    fn proc_pidpath(pid: libc::c_int, buffer: *mut c_void, buffersize: u32) -> libc::c_int;
}

/// Scans on-screen windows without triggering any TCC permission prompt and returns active
/// macOS system prompt/crash dialogs verified by SIP-protected executable path.
pub(super) fn scan_on_screen() -> Vec<MacDialog> {
    let options =
        K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS;
    // SAFETY: CoreGraphics returns a +1 retained CFArrayRef or null.
    let raw = unsafe { CGWindowListCopyWindowInfo(options, K_CG_NULL_WINDOW_ID) };
    let Some(ptr) = std::ptr::NonNull::new(raw.cast_mut()) else {
        return Vec::new();
    };
    // SAFETY: takes ownership of the +1 retained CFArrayRef from CGWindowListCopyWindowInfo.
    let list: CFRetained<CFArray<CFType>> = unsafe { CFRetained::from_raw(ptr.cast()) };

    let mut found = Vec::new();
    for item in list.iter() {
        let Ok(dict) = item.downcast::<CFDictionary>() else {
            continue;
        };
        if let Some(dialog) = classify_window(&dict) {
            found.push(dialog);
        }
    }
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found.dedup_by(|a, b| a.id == b.id);
    found
}

fn classify_window(dict: &CFDictionary) -> Option<MacDialog> {
    let pid = dict_i64(dict, "kCGWindowOwnerPID")?;
    let exe_path = process_path(i32::try_from(pid).ok()?)?;
    let (kind, fallback_title) = classify_system_executable(&exe_path)?;

    if !has_dialog_bounds(dict) {
        return None;
    }

    let owner = dict_string(dict, "kCGWindowOwnerName").unwrap_or_default();
    let win_num = dict_i64(dict, "kCGWindowNumber").unwrap_or(0);
    let name = dict_string(dict, "kCGWindowName").unwrap_or_default();
    let title = if name.trim().is_empty() {
        fallback_title.to_owned()
    } else {
        name.trim().to_owned()
    };

    Some(MacDialog {
        id: format!("{pid}:{win_num}"),
        kind: kind.to_owned(),
        owner,
        title,
    })
}

fn classify_system_executable(path: &str) -> Option<(&'static str, &'static str)> {
    if path.starts_with("/System/Library/Frameworks/Security.framework/")
        && path.ends_with("/SecurityAgent")
    {
        return Some(("mac_password", "macOS password or Keychain prompt"));
    }
    if path.starts_with("/System/Library/CoreServices/Problem Reporter.app/") {
        return Some(("mac_crash", "An app quit unexpectedly"));
    }
    if path.starts_with("/System/Library/CoreServices/CoreServicesUIAgent.app/") {
        return Some(("mac_prompt", "macOS security alert"));
    }
    if path.starts_with("/System/Library/CoreServices/UserNotificationCenter.app/") {
        return Some(("mac_prompt", "macOS system dialog"));
    }
    None
}

fn process_path(pid: i32) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    let mut buf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    // SAFETY: `buf` is valid writable memory of `buf.len()` bytes.
    let len = unsafe { proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if len <= 0 {
        return None;
    }
    String::from_utf8(buf[..len as usize].to_vec()).ok()
}

fn has_dialog_bounds(dict: &CFDictionary) -> bool {
    let Some(bounds_val) = dict_value(dict, "kCGWindowBounds") else {
        return true;
    };
    let Ok(bounds) = bounds_val.downcast::<CFDictionary>() else {
        return true;
    };
    let width = dict_f64(&bounds, "Width").unwrap_or(0.0);
    let height = dict_f64(&bounds, "Height").unwrap_or(0.0);
    width >= 100.0 && height >= 40.0
}

fn dict_value(dict: &CFDictionary, key: &str) -> Option<CFRetained<CFType>> {
    // SAFETY: CoreGraphics window dictionaries are keyed by CFStringRef.
    let typed: &CFDictionary<CFString, CFType> = unsafe { dict.cast_unchecked() };
    typed.get(&CFString::from_str(key))
}

fn dict_string(dict: &CFDictionary, key: &str) -> Option<String> {
    Some(
        dict_value(dict, key)?
            .downcast::<CFString>()
            .ok()?
            .to_string(),
    )
}

fn dict_i64(dict: &CFDictionary, key: &str) -> Option<i64> {
    dict_value(dict, key)?.downcast::<CFNumber>().ok()?.as_i64()
}

fn dict_f64(dict: &CFDictionary, key: &str) -> Option<f64> {
    dict_value(dict, key)?.downcast::<CFNumber>().ok()?.as_f64()
}
