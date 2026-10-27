use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use tracing::warn;

use crate::error::{Error, Result};

pub const DIR_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;
const TEMP_SUFFIX: &str = ".tmp";
const CORRUPT_PREFIX: &str = ".corrupt-";
const CORRUPT_MARKER: &str = ".corrupt";

pub fn ensure_dir(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(DIR_MODE))
}

pub fn read(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Writes `bytes` so that a crash at any instant leaves either the old file or the new one: the
/// same directory gets a temporary file, flushed to disk, renamed over the target, and the rename
/// itself is made durable by flushing the directory.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let temp = dir.join(temp_name(path));
    let result = write_then_rename(&temp, path, bytes);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;
    sync_dir(dir)
}

fn write_then_rename(temp: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(FILE_MODE)
        .open(temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temp, path)
}

fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

fn temp_name(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!("{name}{TEMP_SUFFIX}")
}

/// Reads a JSON state file. A file that is not valid JSON is moved aside as
/// `<name>.corrupt-<unix secs>` and reported as missing, so one corrupt file cannot keep the
/// daemon from starting; `label` names it in the warning.
pub fn read_json<T: DeserializeOwned>(path: &Path, label: &str) -> Result<Option<T>> {
    let Some(bytes) = read(path)? else {
        return Ok(None);
    };
    match serde_json::from_slice(&bytes) {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let aside = move_aside(path);
            warn!(
                file = %path.display(),
                aside = aside.as_ref().map(|path| path.display().to_string()).unwrap_or_default(),
                error = %error,
                "{label} could not be read; starting from nothing"
            );
            Ok(None)
        }
    }
}

fn move_aside(path: &Path) -> Option<PathBuf> {
    let aside = path.with_extension(format!("{CORRUPT_MARKER}-{}", crate::clock::unix_secs()));
    let aside = unique(&aside);
    fs::rename(path, &aside).ok().map(|()| aside)
}

fn unique(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| CORRUPT_PREFIX.to_owned());
    let mut candidate = path.to_path_buf();
    let mut index = 1;
    while candidate.exists() {
        candidate.set_file_name(format!("{name}-{index}"));
        index += 1;
    }
    candidate
}

/// The identity is the one file a corrupt write must never silently replace: regenerating it
/// unpairs every device, so the caller is told to act instead.
pub fn corrupted_identity(path: &Path, error: impl std::fmt::Display) -> Error {
    Error::message(format!(
        "{} is unreadable ({error}); refusing to start. Restore it from a backup, or delete it and \
         pair every device again",
        path.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_write_leaves_the_old_file_intact_until_the_rename() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("state.json");
        write_atomic(&path, b"old").expect("first write");
        let temp = dir.path().join(temp_name(&path));
        write_then_rename(&temp, &path, b"new").expect("second write");
        assert_eq!(fs::read(&path).expect("the file is there"), b"new");
        assert!(!temp.exists(), "the temporary file is gone");
    }

    #[test]
    fn an_unreadable_file_is_moved_aside() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("devices.json");
        fs::write(&path, b"{not json").expect("write");
        let read: Option<Vec<String>> = read_json(&path, "devices").expect("read");
        assert!(read.is_none());
        assert!(!path.exists());
        let aside: Vec<PathBuf> = fs::read_dir(dir.path())
            .expect("list")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.to_string_lossy().contains(CORRUPT_MARKER))
            .collect();
        assert_eq!(aside.len(), 1, "the unreadable file is kept aside");
    }
}
