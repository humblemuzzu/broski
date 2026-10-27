use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::fsx;
use tracing::warn;

const FILE: &str = "letters_seen.json";
const MAX_ENTRIES: usize = 10_000;

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    id: String,
    at: u64,
}

struct Data {
    entries: Vec<Entry>,
}

/// The letter ids already handled, so a redelivered letter is never acted on twice.
pub struct Seen {
    path: PathBuf,
    ttl: Duration,
    data: Mutex<Data>,
}

impl Seen {
    pub async fn open(home: &Path, ttl: Duration) -> Result<Arc<Seen>> {
        let path = home.join(FILE);
        let entries: Vec<Entry> =
            fsx::read_json(&path, "the letters already handled")?.unwrap_or_else(Vec::new);
        Ok(Arc::new(Seen {
            path,
            ttl,
            data: Mutex::new(Data { entries }),
        }))
    }

    /// True when `id` was seen inside the window; either way it is remembered now.
    pub async fn check_and_mark(&self, id: &str, now: u64) -> bool {
        let cutoff = now.saturating_sub(self.ttl.as_millis() as u64);
        let seen = {
            let mut data = self.lock();
            data.entries.retain(|entry| entry.at >= cutoff);
            if data.entries.iter().any(|entry| entry.id == id) {
                return true;
            }
            data.entries.push(Entry {
                id: id.to_owned(),
                at: now,
            });
            if data.entries.len() > MAX_ENTRIES {
                let oldest = data
                    .entries
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, entry)| entry.at)
                    .map(|(index, _)| index);
                if let Some(index) = oldest {
                    data.entries.remove(index);
                }
            }
            data.entries.clone()
        };
        self.persist(seen).await;
        false
    }

    /// Drops `id`, so a letter that was opened but could not be acted on is handled again when
    /// the relay redelivers it.
    pub async fn forget(&self, id: &str) {
        let remaining = {
            let mut data = self.lock();
            let before = data.entries.len();
            data.entries.retain(|entry| entry.id != id);
            if data.entries.len() == before {
                return;
            }
            data.entries.clone()
        };
        self.persist(remaining).await;
    }

    async fn persist(&self, entries: Vec<Entry>) {
        let Ok(bytes) = serde_json::to_vec(&entries) else {
            return;
        };
        let path = self.path.clone();
        match tokio::task::spawn_blocking(move || fsx::write_atomic(&path, &bytes)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                warn!(error = %error, "the letters already handled were not written")
            }
            Err(error) => {
                warn!(error = %error, "the letters already handled were not written")
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Data> {
        self.data.lock().unwrap_or_else(|error| error.into_inner())
    }
}
