//! The last known inbox, as bytes the app persists and hands back at its next start, so the home
//! screen shows at once and offline. The core does no storage I/O.
//!
//! The bytes are versioned JSON of each row's text and state, at most `MAX_CACHED_ROWS` rows (the
//! top of the inbox) and `MAX_CACHE_BYTES`. A new cache is handed out when that content changed, at
//! most once every `CACHE_INTERVAL`, so the app writes its keychain or DataStore rarely; a change
//! within the interval goes out when it ends.

use std::collections::HashMap;
use std::time::Duration;

use broski_contract::{SessionRef, WorkingDirectory};
use serde::{Deserialize, Serialize};
use tokio::time::Instant;

use super::{InboxRow, InboxState};
use crate::error::ClientError;

const CACHE_VERSION: u32 = 1;
pub(crate) const MAX_CACHED_ROWS: usize = 100;
pub(crate) const MAX_CACHE_BYTES: usize = 64 * 1024;
/// A title, an ask or a command longer than this is cut: the inbox shows one line of each.
const MAX_CACHED_TEXT_CHARS: usize = 300;
pub(crate) const CACHE_INTERVAL: Duration = Duration::from_secs(2);

/// What the cache keeps of a row: never its pending ask, which only a live view can offer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CachedRow {
    pub(super) machine_id: String,
    pub(super) machine_name: String,
    pub(super) session: SessionRef,
    pub(super) title: Option<String>,
    pub(super) cwd: Option<WorkingDirectory>,
    pub(super) state: InboxState,
    pub(super) updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) run_started_at: Option<i64>,
    pub(super) ask: Option<String>,
    pub(super) command: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    rows: Vec<CachedRow>,
}

/// Whether the rows shown now call for a new cache.
pub(super) enum CacheDue {
    Now(Vec<CachedRow>),
    At(Instant),
    Unchanged,
}

#[derive(Default)]
pub(super) struct Cache {
    /// What the app restored, by machine, until that machine's lists load.
    restored: HashMap<String, Vec<CachedRow>>,
    emitted: Option<(Vec<CachedRow>, Instant)>,
}

impl Cache {
    pub(super) fn restore(&mut self, bytes: &[u8]) -> Result<(), ClientError> {
        let file: CacheFile =
            serde_json::from_slice(bytes).map_err(|error| ClientError::InvalidRequest {
                detail: format!("not an inbox cache: {error}"),
            })?;
        if file.version != CACHE_VERSION {
            return Err(ClientError::InvalidRequest {
                detail: format!(
                    "an inbox cache of version {}, not {CACHE_VERSION}",
                    file.version
                ),
            });
        }
        self.restored.clear();
        for row in file.rows.into_iter().take(MAX_CACHED_ROWS) {
            self.restored
                .entry(row.machine_id.clone())
                .or_default()
                .push(row);
        }
        Ok(())
    }

    pub(super) fn rows_of(&self, machine_id: &str) -> &[CachedRow] {
        self.restored.get(machine_id).map_or(&[], Vec::as_slice)
    }

    /// The machine's own rows are in, or it was forgotten: its cached rows go.
    pub(super) fn drop_machine(&mut self, machine_id: &str) {
        self.restored.remove(machine_id);
    }

    pub(super) fn check(&self, rows: &[InboxRow], now: Instant) -> CacheDue {
        let kept = kept(rows);
        match &self.emitted {
            Some((emitted, _)) if *emitted == kept => CacheDue::Unchanged,
            Some((_, at)) if now < *at + CACHE_INTERVAL => CacheDue::At(*at + CACHE_INTERVAL),
            _ => CacheDue::Now(kept),
        }
    }

    /// The bytes of `rows`, which `check` found due, now handed out.
    pub(super) fn emit(&mut self, rows: Vec<CachedRow>, now: Instant) -> Vec<u8> {
        let bytes = encode(&rows);
        self.emitted = Some((rows, now));
        bytes
    }
}

/// The top rows, within the row bound; the byte bound is met when they are encoded.
fn kept(rows: &[InboxRow]) -> Vec<CachedRow> {
    rows.iter()
        .take(MAX_CACHED_ROWS)
        .map(|row| CachedRow {
            machine_id: row.machine_id.clone(),
            machine_name: row.machine_name.clone(),
            session: row.session.clone(),
            title: row.title.as_deref().map(clip),
            cwd: row.cwd.clone(),
            state: row.state,
            updated_at: row.updated_at,
            run_started_at: row.run_started_at,
            ask: row.ask.as_deref().map(clip),
            command: row.command.as_deref().map(clip),
        })
        .collect()
}

fn clip(text: &str) -> String {
    text.chars().take(MAX_CACHED_TEXT_CHARS).collect()
}

/// As many rows from the top as fit in `MAX_CACHE_BYTES`.
fn encode(rows: &[CachedRow]) -> Vec<u8> {
    let envelope = serde_json::to_vec(&CacheFile {
        version: CACHE_VERSION,
        rows: Vec::new(),
    })
    .unwrap_or_default();
    let mut budget = MAX_CACHE_BYTES.saturating_sub(envelope.len());
    let fitting = rows
        .iter()
        .take_while(|row| {
            let size = serde_json::to_vec(row).map_or(usize::MAX, |bytes| bytes.len() + 1);
            let fits = size <= budget;
            budget = budget.saturating_sub(size);
            fits
        })
        .count();
    let file = CacheFile {
        version: CACHE_VERSION,
        rows: rows[..fitting].to_vec(),
    };
    serde_json::to_vec(&file).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use broski_contract::BackendId;

    use super::*;

    fn row(index: usize, title: &str) -> InboxRow {
        InboxRow {
            machine_id: "m".to_owned(),
            machine_name: "Mac".to_owned(),
            session: SessionRef {
                backend: BackendId::Pi,
                session_id: format!("s{index}"),
            },
            title: Some(title.to_owned()),
            cwd: Some("/w".to_owned()),
            state: InboxState::Done,
            updated_at: index as i64,
            run_started_at: None,
            ask: None,
            command: None,
            pending: None,
            cached: false,
        }
    }

    #[test]
    fn the_cache_round_trips_and_keeps_its_bounds() {
        let rows: Vec<InboxRow> = (0..MAX_CACHED_ROWS + 20)
            .map(|index| row(index, &"t".repeat(2_000)))
            .collect();
        let mut cache = Cache::default();
        let now = Instant::now();
        let CacheDue::Now(kept) = cache.check(&rows, now) else {
            panic!("a first cache is due");
        };
        let bytes = cache.emit(kept, now);
        assert!(bytes.len() <= MAX_CACHE_BYTES, "{} bytes", bytes.len());

        let mut restored = Cache::default();
        restored.restore(&bytes).expect("restored");
        let back = restored.rows_of("m");
        assert!(!back.is_empty() && back.len() <= MAX_CACHED_ROWS);
        assert_eq!(
            back[0].session, rows[0].session,
            "the top of the inbox is kept"
        );
        assert_eq!(
            back[0].title.as_ref().map(|title| title.chars().count()),
            Some(MAX_CACHED_TEXT_CHARS)
        );
    }

    #[test]
    fn a_change_waits_out_the_interval_and_nothing_unchanged_is_handed_out() {
        let mut cache = Cache::default();
        let start = Instant::now();
        let CacheDue::Now(kept) = cache.check(&[row(1, "a")], start) else {
            panic!("due");
        };
        cache.emit(kept, start);
        assert!(matches!(
            cache.check(&[row(1, "a")], start),
            CacheDue::Unchanged
        ));
        let mut live = row(1, "a");
        live.cached = true;
        assert!(
            matches!(cache.check(&[live], start), CacheDue::Unchanged),
            "only what the cache keeps counts"
        );
        match cache.check(&[row(1, "b")], start + Duration::from_millis(500)) {
            CacheDue::At(at) => assert_eq!(at, start + CACHE_INTERVAL),
            _ => panic!("a change within the interval waits"),
        }
        assert!(matches!(
            cache.check(&[row(1, "b")], start + CACHE_INTERVAL),
            CacheDue::Now(_)
        ));
    }

    #[test]
    fn bytes_of_another_version_or_none_at_all_are_refused() {
        let mut cache = Cache::default();
        assert!(cache.restore(b"{\"version\":2,\"rows\":[]}").is_err());
        assert!(cache.restore(b"not json").is_err());
        assert!(cache.restore(b"{\"version\":1,\"rows\":[]}").is_ok());
    }
}
