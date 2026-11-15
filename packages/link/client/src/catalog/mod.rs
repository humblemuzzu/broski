//! A machine's catalog: its backends and their status, the models, commands and modes each lists
//! (kept until `catalog_invalidated`), and session lists kept current by the catalog's rows.

pub(crate) mod lists;
mod session_list;
pub(crate) mod state;

use std::hash::Hash;
use std::sync::Arc;

use broski_contract::{
    BackendDescriptor, BackendId, BackendStatus, BackendStatusRequest, BackendsListRequest,
    CatalogScope, ClientMessage, CommandsListRequest, CommandsListResult, ModelsListRequest,
    ModelsListResult, ModesListRequest, ModesListResult, ServerMessage, SessionQuery, SessionRef,
    SessionsListResult, MAX_PAGE_LIMIT,
};
use broski_link_session::LinkState;
use tokio::task::JoinHandle;

pub use self::session_list::{SessionList, SessionListUpdate};
use self::state::{Cache, Catalog, ListKey};
use crate::error::ClientError;
use crate::machine::{unexpected, Machine, Shared};

/// Rows a session list asks for at a time.
const PAGE_LIMIT: i64 = 50;

/// How a cached read is asked for, kept and read out of its answer.
struct Cached<K, V> {
    cache: fn(&mut Catalog) -> &mut Cache<K, V>,
    key: K,
    backend: BackendId,
    scope: CatalogScope,
    read: fn(ServerMessage) -> Result<V, ClientError>,
    accepted: fn(&V) -> bool,
}

impl Machine {
    /// The backends the bridge serves now.
    pub async fn backends(&self) -> Result<Vec<BackendDescriptor>, ClientError> {
        let known = self.shared().lock().catalog.backends();
        match known {
            Some(backends) => Ok(backends),
            None => self
                .shared()
                .fetch_backends()
                .await
                .map(|(backends, _)| backends),
        }
    }

    pub async fn backend_status(&self, backend: BackendId) -> Result<BackendStatus, ClientError> {
        if let Some(status) = self.shared().lock().catalog.status_of(backend) {
            return Ok(status);
        }
        let request = ClientMessage::BackendStatus(BackendStatusRequest {
            request_id: String::new(),
            backend,
        });
        let status = match self.shared().request(request).await? {
            ServerMessage::BackendStatusResult(answer) => answer.status,
            other => return Err(unexpected(&other)),
        };
        let mut state = self.shared().lock();
        if state.catalog.status_of(backend).is_none() {
            state.catalog.set_status(backend, status.clone());
        }
        Ok(status)
    }

    pub async fn models(
        &self,
        backend: BackendId,
        cwd: Option<String>,
        include_unavailable: bool,
    ) -> Result<ModelsListResult, ClientError> {
        let request = ClientMessage::ModelsList(ModelsListRequest {
            request_id: String::new(),
            backend,
            cwd: cwd.clone(),
            include_unavailable: include_unavailable.then_some(true),
        });
        let how = Cached {
            cache: |catalog| &mut catalog.models,
            key: ListKey {
                backend,
                cwd,
                extra: include_unavailable,
            },
            backend,
            scope: CatalogScope::Models,
            read: |answer| match answer {
                ServerMessage::ModelsListResult(answer) => Ok(answer.result),
                other => Err(unexpected(&other)),
            },
            accepted: |result| matches!(result, ModelsListResult::Accepted(_)),
        };
        self.shared().cached(request, how).await
    }

    pub async fn commands(
        &self,
        backend: BackendId,
        cwd: Option<String>,
        session: Option<SessionRef>,
    ) -> Result<CommandsListResult, ClientError> {
        let extra = session
            .as_ref()
            .map(|session| (session.backend, session.session_id.clone()));
        let request = ClientMessage::CommandsList(CommandsListRequest {
            request_id: String::new(),
            backend,
            cwd: cwd.clone(),
            session,
        });
        let how = Cached {
            cache: |catalog| &mut catalog.commands,
            key: ListKey {
                backend,
                cwd,
                extra,
            },
            backend,
            scope: CatalogScope::Commands,
            read: |answer| match answer {
                ServerMessage::CommandsListResult(answer) => Ok(answer.result),
                other => Err(unexpected(&other)),
            },
            accepted: |result| matches!(result, CommandsListResult::Accepted(_)),
        };
        self.shared().cached(request, how).await
    }

    pub async fn modes(
        &self,
        backend: BackendId,
        cwd: Option<String>,
    ) -> Result<ModesListResult, ClientError> {
        let request = ClientMessage::ModesList(ModesListRequest {
            request_id: String::new(),
            backend,
            cwd: cwd.clone(),
        });
        let how = Cached {
            cache: |catalog| &mut catalog.modes,
            key: ListKey {
                backend,
                cwd,
                extra: (),
            },
            backend,
            scope: CatalogScope::Modes,
            read: |answer| match answer {
                ServerMessage::ModesListResult(answer) => Ok(answer.result),
                other => Err(unexpected(&other)),
            },
            accepted: |result| matches!(result, ModesListResult::Accepted(_)),
        };
        self.shared().cached(request, how).await
    }

    /// The sessions of `backend` that `query` names, newest first, kept current by the catalog.
    /// `query.cwd` must be spelled as the bridge spells directories (from a row, `workspace.info` or
    /// `fs.list`), since rows are matched to lists by it. The first page loads at once.
    pub fn session_list(
        self: Arc<Self>,
        backend: BackendId,
        query: SessionQuery,
    ) -> Result<Arc<SessionList>, ClientError> {
        let id = {
            let mut state = self.shared().lock();
            if let Some(error) = &state.ended {
                return Err(error.clone());
            }
            state.catalog.lists.create(backend, query, PAGE_LIMIT)
        };
        self.shared().spawn_load(id, false);
        Ok(Arc::new(SessionList::new(self, id)))
    }
}

impl Shared {
    async fn cached<K: Hash + Eq, V: Clone>(
        &self,
        request: ClientMessage,
        how: Cached<K, V>,
    ) -> Result<V, ClientError> {
        let stamp = {
            let mut state = self.lock();
            if let Some(hit) = (how.cache)(&mut state.catalog).get(&how.key) {
                return Ok(hit);
            }
            state.catalog.stamp(how.backend, how.scope)
        };
        let value = (how.read)(self.request(request).await?)?;
        if (how.accepted)(&value) {
            let mut state = self.lock();
            if state.catalog.stamp(how.backend, how.scope) == stamp {
                (how.cache)(&mut state.catalog).insert(how.key, value.clone());
            }
        }
        Ok(value)
    }

    /// Lists the backends, and gives each new one its inbox list; returns the backends and the
    /// lists it created.
    pub(crate) async fn fetch_backends(
        &self,
    ) -> Result<(Vec<BackendDescriptor>, Vec<u64>), ClientError> {
        let request = ClientMessage::BackendsList(BackendsListRequest {
            request_id: String::new(),
        });
        let backends = match self.request(request).await? {
            ServerMessage::BackendsListResult(answer) => answer.backends,
            other => return Err(unexpected(&other)),
        };
        let mut state = self.lock();
        state.catalog.set_backends(backends.clone());
        state.events.backends();
        let created = backends
            .iter()
            .filter_map(|backend| inbox_list(&mut state.catalog, backend.id))
            .collect();
        Ok((backends, created))
    }

    /// After a new bridge socket: the backends again, and every list from its first page.
    pub(crate) fn refresh_catalog(self: &Arc<Self>) {
        let shared = Arc::clone(self);
        self.runtime().handle().spawn(async move {
            if let Err(error) = shared.fetch_backends().await {
                tracing::debug!(%error, "listing the backends failed");
            }
            let lists = shared.lock().catalog.lists.ids();
            for list in lists {
                shared.spawn_load(list, true);
            }
        });
    }

    /// A backend landed that the list did not have.
    pub(crate) fn relist_backends(self: &Arc<Self>) {
        let shared = Arc::clone(self);
        self.runtime().handle().spawn(async move {
            match shared.fetch_backends().await {
                Ok((_, created)) => created
                    .into_iter()
                    .for_each(|list| shared.spawn_load(list, false)),
                Err(error) => tracing::debug!(%error, "listing the backends failed"),
            }
        });
    }

    /// The inbox's lists from their first page again, each fetched on the link runtime; the handles
    /// finish once the pages are answered. A link that is down, or a bridge that has not agreed on
    /// the protocol, would only hold the requests, so then a link waiting to dial dials now instead.
    pub(crate) fn reload_inbox(self: &Arc<Self>) -> Vec<JoinHandle<()>> {
        let (ready, waiting, lists) = {
            let state = self.lock();
            let lists: Vec<u64> = state.catalog.inbox.iter().map(|(_, id)| *id).collect();
            let connected = matches!(state.link.state, LinkState::Connected { .. });
            let waiting = matches!(state.link.state, LinkState::Waiting(_));
            (connected && state.contract.ready(), waiting, lists)
        };
        if !ready {
            if waiting {
                self.session().network_changed();
            }
            return Vec::new();
        }
        lists
            .into_iter()
            .map(|list| {
                let shared = Arc::clone(self);
                self.runtime().handle().spawn(async move {
                    if let Err(error) = shared.fetch_page(list, true).await {
                        tracing::debug!(%error, "reloading an inbox list failed");
                    }
                })
            })
            .collect()
    }

    pub(crate) fn spawn_load(self: &Arc<Self>, list: u64, reload: bool) {
        let shared = Arc::clone(self);
        self.runtime().handle().spawn(async move {
            if let Err(error) = shared.fetch_page(list, reload).await {
                tracing::debug!(%error, "a session list page failed");
            }
        });
    }

    /// The list's next page, or its first again with `reload`. The page is fetched on the link
    /// runtime, so a caller that stops waiting (Kotlin frees the future of a cancelled coroutine)
    /// still leaves the list settled: `ask` marks it loading, and only the answer clears that.
    pub(crate) async fn load(self: &Arc<Self>, list: u64, reload: bool) -> Result<(), ClientError> {
        let shared = Arc::clone(self);
        let fetching = self
            .runtime()
            .handle()
            .spawn(async move { shared.fetch_page(list, reload).await });
        fetching.await.map_err(|_| ClientError::Closed)?
    }

    async fn fetch_page(&self, list: u64, reload: bool) -> Result<(), ClientError> {
        let asked = self
            .lock()
            .catalog
            .lists
            .get_mut(list)
            .and_then(|list| list.ask(reload));
        let Some((ask, request)) = asked else {
            return Ok(());
        };
        let page = match self.request(request).await {
            Ok(ServerMessage::SessionsListResult(answer)) => match answer.result {
                SessionsListResult::Accepted(listed) => Ok(listed.page),
                SessionsListResult::Rejected(rejected) => Err(ClientError::Rejected {
                    code: rejected.rejection.code,
                    detail: rejected.rejection.message,
                }),
            },
            Ok(other) => Err(unexpected(&other)),
            Err(error) => Err(error),
        };
        let mut state = self.lock();
        let Some(list) = state.catalog.lists.get_mut(list) else {
            return Ok(());
        };
        match page {
            Ok(page) => {
                list.page(&ask, page);
                self.poke_inbox();
                Ok(())
            }
            Err(error) => {
                list.page_failed(ask.generation);
                Err(error)
            }
        }
    }
}

/// The inbox's list of `backend`'s newest top-level sessions, created when the backend has none.
fn inbox_list(catalog: &mut Catalog, backend: BackendId) -> Option<u64> {
    if catalog.inbox.iter().any(|(known, _)| *known == backend) {
        return None;
    }
    let query = SessionQuery {
        cwd: None,
        parent: None,
    };
    let limit = MAX_PAGE_LIMIT as i64;
    let list = catalog
        .lists
        .create_bounded(backend, query, limit, MAX_PAGE_LIMIT);
    catalog.inbox.push((backend, list));
    Some(list)
}
