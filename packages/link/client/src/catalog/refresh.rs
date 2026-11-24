//! Reading a machine's catalog again on each new bridge socket. A read that fails is asked again
//! after a pause that grows, for as long as that socket is the one in use, so lists left unloaded
//! (and the inbox's last known rows standing in for them) do not wait for a pull to refresh.

use std::future::Future;
use std::sync::{Arc, Weak};

use crate::attach::backoff;
use crate::error::ClientError;
use crate::machine::state::{Contract, State};
use crate::machine::Shared;

impl State {
    /// The bridge socket in use when it is ready, and the machine has not ended.
    pub(crate) fn ready_conn(&self) -> Option<u64> {
        match self.contract {
            Contract::Ready { conn, .. } if self.ended.is_none() => Some(conn),
            _ => None,
        }
    }
}

impl Shared {
    /// After the new bridge socket `conn` agreed on the protocol: the backends again, and every
    /// list from its first page.
    pub(crate) fn refresh_catalog(self: &Arc<Self>, conn: u64) {
        let shared = Arc::downgrade(self);
        self.runtime().handle().spawn(async move {
            let listed = until_read(&shared, conn, "listing the backends", |shared| async move {
                shared.fetch_backends().await.map(drop)
            })
            .await;
            let Some(shared) = shared.upgrade().filter(|_| listed) else {
                return;
            };
            let lists = {
                let mut state = shared.lock();
                state.catalog.kept.forget_reads();
                state.catalog.lists.ids()
            };
            for list in lists {
                shared.spawn_page(list, true);
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
                    .for_each(|list| shared.spawn_page(list, false)),
                Err(error) => tracing::debug!(%error, "listing the backends failed"),
            }
        });
    }

    /// Loads the list's next page, or its first again with `reload`, on the link runtime; on a
    /// ready bridge until it is read. A bridge not ready yet is left to read it once it is.
    pub(crate) fn spawn_page(self: &Arc<Self>, list: u64, reload: bool) {
        let conn = self.lock().ready_conn();
        self.spawn_page_on(list, reload, conn);
    }

    pub(crate) fn spawn_page_on(self: &Arc<Self>, list: u64, reload: bool, conn: Option<u64>) {
        let shared = Arc::downgrade(self);
        self.runtime().handle().spawn(async move {
            let read = |shared: Arc<Shared>| async move { shared.fetch_page(list, reload).await };
            match conn {
                Some(conn) => {
                    until_read(&shared, conn, "a session list page", read).await;
                }
                None => {
                    if let Some(shared) = shared.upgrade() {
                        if let Err(error) = read(shared).await {
                            tracing::debug!(%error, "a session list page failed");
                        }
                    }
                }
            }
        });
    }
}

/// Runs `read` until it succeeds, pausing longer after each failure; false once the bridge socket
/// `conn` is no longer the one in use and ready (a new one reads everything again), or the machine
/// is gone. Only a weak handle is kept across a pause.
async fn until_read<F, R>(shared: &Weak<Shared>, conn: u64, what: &str, mut read: F) -> bool
where
    F: FnMut(Arc<Shared>) -> R,
    R: Future<Output = Result<(), ClientError>>,
{
    let mut failures = 0;
    loop {
        let Some(strong) = current(shared, conn) else {
            return false;
        };
        match read(strong).await {
            Ok(()) => return true,
            Err(error) => tracing::debug!(%error, what, "a catalog read failed; it goes again"),
        }
        tokio::time::sleep(backoff(failures)).await;
        failures += 1;
    }
}

fn current(shared: &Weak<Shared>, conn: u64) -> Option<Arc<Shared>> {
    let shared = shared.upgrade()?;
    let ready = shared.lock().ready_conn() == Some(conn);
    ready.then_some(shared)
}
