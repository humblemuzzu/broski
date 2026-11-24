use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod unsupported;
pub mod watcher;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MacDialog {
    pub id: String,
    pub kind: String,
    pub owner: String,
    pub title: String,
}

pub fn scan_on_screen() -> Vec<MacDialog> {
    #[cfg(target_os = "macos")]
    {
        macos::scan_on_screen()
    }
    #[cfg(not(target_os = "macos"))]
    {
        unsupported::scan_on_screen()
    }
}
