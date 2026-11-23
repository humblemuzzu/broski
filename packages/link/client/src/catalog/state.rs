//! What one machine's bridge said about its backends, kept until the catalog says it changed.

use std::collections::HashMap;
use std::hash::Hash;

use broski_contract::{
    BackendDescriptor, BackendId, BackendStatus, CatalogScope, CommandsListResult,
    ModelsListResult, ModesListResult,
};

use super::kept::Kept;
use super::lists::Lists;

/// Entries a cache keeps; past them it starts over. A phone asks for the lists of a handful of
/// directories, so this is never the working set.
const CACHE_ENTRIES: usize = 64;

pub(crate) struct Cache<K, V> {
    entries: HashMap<K, V>,
}

impl<K, V> Default for Cache<K, V> {
    fn default() -> Self {
        Cache {
            entries: HashMap::new(),
        }
    }
}

impl<K: Hash + Eq, V: Clone> Cache<K, V> {
    pub(crate) fn get(&self, key: &K) -> Option<V> {
        self.entries.get(key).cloned()
    }

    pub(crate) fn insert(&mut self, key: K, value: V) {
        if self.entries.len() >= CACHE_ENTRIES {
            self.entries.clear();
        }
        self.entries.insert(key, value);
    }

    fn forget(&mut self, keep: impl Fn(&K) -> bool) {
        self.entries.retain(|key, _| keep(key));
    }
}

/// A list asked for by backend and directory; `extra` is what else the request names.
#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) struct ListKey<E> {
    pub(crate) backend: BackendId,
    pub(crate) cwd: Option<String>,
    pub(crate) extra: E,
}

/// Which catalog a cached answer is still current for: one that changed since it was asked for is
/// not kept.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Stamp {
    epoch: u64,
    scope: u64,
}

#[derive(Default)]
pub(crate) struct Catalog {
    backends: Option<Vec<BackendDescriptor>>,
    statuses: HashMap<BackendId, BackendStatus>,
    pub(crate) models: Cache<ListKey<bool>, ModelsListResult>,
    pub(crate) commands: Cache<ListKey<Option<(BackendId, String)>>, CommandsListResult>,
    pub(crate) modes: Cache<ListKey<()>, ModesListResult>,
    /// Bumped when a new bridge socket makes everything above stale.
    epoch: u64,
    scopes: HashMap<(BackendId, CatalogScope), u64>,
    pub(crate) lists: Lists,
    /// The list of each backend's newest sessions the inbox shows.
    pub(crate) inbox: Vec<(BackendId, u64)>,
    /// What the inbox searches for, with one list of each backend's sessions that match it.
    pub(crate) search: Option<InboxSearch>,
    /// The sessions pinned on this machine, which the inbox shows whether or not a list holds them.
    pub(crate) kept: Kept,
}

pub(crate) struct InboxSearch {
    pub(crate) query: String,
    pub(crate) lists: Vec<(BackendId, u64)>,
}

impl Catalog {
    pub(crate) fn backends(&self) -> Option<Vec<BackendDescriptor>> {
        self.backends.clone()
    }

    pub(crate) fn set_backends(&mut self, backends: Vec<BackendDescriptor>) {
        self.backends = Some(backends);
    }

    pub(crate) fn status_of(&self, backend: &str) -> Option<BackendStatus> {
        self.statuses.get(backend).cloned()
    }

    /// True when the backend is one already listed.
    pub(crate) fn set_status(&mut self, backend: BackendId, status: BackendStatus) -> bool {
        let listed = self
            .backends
            .as_ref()
            .is_some_and(|backends| backends.iter().any(|known| known.id == backend));
        self.statuses.insert(backend, status);
        listed
    }

    pub(crate) fn stamp(&self, backend: &str, scope: CatalogScope) -> Stamp {
        Stamp {
            epoch: self.epoch,
            scope: self
                .scopes
                .get(&(backend.to_owned(), scope))
                .copied()
                .unwrap_or(0),
        }
    }

    pub(crate) fn invalidate(&mut self, backend: &str, scope: CatalogScope) {
        *self.scopes.entry((backend.to_owned(), scope)).or_default() += 1;
        let other = |key_backend: &str| key_backend != backend;
        match scope {
            CatalogScope::Models => self.models.forget(|key| other(&key.backend)),
            CatalogScope::Commands => self.commands.forget(|key| other(&key.backend)),
            CatalogScope::Modes => self.modes.forget(|key| other(&key.backend)),
        }
    }

    /// A new bridge socket: whatever its catalog said while this phone was not listening is unknown.
    pub(crate) fn forget(&mut self) {
        self.epoch += 1;
        self.backends = None;
        self.statuses.clear();
        self.models = Cache::default();
        self.commands = Cache::default();
        self.modes = Cache::default();
    }
}

#[cfg(test)]
mod tests {
    use broski_contract::{ModelsListed, ModesListed};

    use super::*;

    fn key(backend: &str) -> ListKey<bool> {
        ListKey {
            backend: backend.to_owned(),
            cwd: None,
            extra: false,
        }
    }

    fn models() -> ModelsListResult {
        ModelsListResult::Accepted(ModelsListed { models: Vec::new() })
    }

    #[test]
    fn an_invalidation_drops_that_backends_scope_and_a_list_asked_for_before_it() {
        let mut catalog = Catalog::default();
        catalog.models.insert(key("pi"), models());
        catalog.models.insert(key("claude-code"), models());
        let modes = ModesListResult::Accepted(ModesListed { modes: Vec::new() });
        let modes_key = ListKey {
            backend: "pi".to_owned(),
            cwd: None,
            extra: (),
        };
        catalog.modes.insert(modes_key.clone(), modes);
        let asked = catalog.stamp("pi", CatalogScope::Models);
        let other = catalog.stamp("claude-code", CatalogScope::Models);

        catalog.invalidate("pi", CatalogScope::Models);
        assert!(catalog.models.get(&key("pi")).is_none());
        assert!(
            catalog.models.get(&key("claude-code")).is_some(),
            "another backend's"
        );
        assert!(catalog.modes.get(&modes_key).is_some(), "another scope");
        assert!(
            catalog.stamp("pi", CatalogScope::Models) != asked,
            "stale once answered"
        );
        assert!(catalog.stamp("claude-code", CatalogScope::Models) == other);

        catalog.forget();
        assert!(catalog.models.get(&key("claude-code")).is_none());
        assert!(
            catalog.stamp("claude-code", CatalogScope::Models) != other,
            "a new socket"
        );
    }
}
