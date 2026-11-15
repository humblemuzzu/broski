//! One machine's state behind one lock, the link session it runs over, and how requests reach the
//! bridge: sent at once on a bridge that agreed on the protocol, held in order until one has.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use broski_contract::{
    ClientInfo, ClientMessage, ProtocolErrorCode, ServerMessage, MAX_PAGE_LIMIT,
};
use broski_link_session::{BridgeStatus, LinkRuntime, MachineRecord, SendFailure, Session, Status};
use tokio::sync::{oneshot, Notify};
use tokio::time::Instant;

use super::events::{ContractState, MachineEvents, MachineStatus};
use crate::attach::RATE_LIMIT_PAUSE;
use crate::catalog::state::Catalog;
use crate::error::ClientError;
use crate::requests::{self, Answer, Requests, Waiter, MAX_PENDING_REQUESTS};
use crate::terminal::state::Terminals;
use crate::view::stream::Streams;
use crate::{wait, wire};

/// Where the bridge socket in use stands with this client. `conn` is the daemon's count of this
/// link session's bridge sockets: a new one knows nothing of this phone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Contract {
    Waiting,
    /// `refused`: the hellos this socket refused before this one.
    Hello {
        conn: u64,
        refused: u32,
    },
    /// The socket refused the hello for a reason other than the version; it is said again later.
    Refused {
        conn: u64,
        refused: u32,
        message: String,
    },
    Ready {
        conn: u64,
        bridge_version: String,
    },
    Incompatible {
        conn: u64,
        message: String,
    },
}

impl Contract {
    pub(crate) fn conn(&self) -> Option<u64> {
        match self {
            Contract::Waiting => None,
            Contract::Hello { conn, .. }
            | Contract::Refused { conn, .. }
            | Contract::Ready { conn, .. }
            | Contract::Incompatible { conn, .. } => Some(*conn),
        }
    }

    pub(crate) fn ready(&self) -> bool {
        matches!(self, Contract::Ready { .. })
    }
}

pub(crate) struct State {
    pub(crate) record: MachineRecord,
    pub(crate) link: Status,
    pub(crate) bridge: Option<BridgeStatus>,
    pub(crate) contract: Contract,
    /// Set once the machine is closed or revoked; every call fails with it.
    pub(crate) ended: Option<ClientError>,
    pub(crate) requests: Requests,
    pub(crate) streams: Streams,
    pub(crate) terminals: Terminals,
    pub(crate) catalog: Catalog,
    pub(crate) events: MachineEvents,
}

impl State {
    pub(crate) fn status(&self) -> MachineStatus {
        MachineStatus {
            link: self.link.clone(),
            bridge: self.bridge.clone(),
            contract: match &self.contract {
                Contract::Waiting | Contract::Hello { .. } => ContractState::Waiting,
                Contract::Refused { message, .. } => ContractState::Refused {
                    message: message.clone(),
                },
                Contract::Ready { bridge_version, .. } => ContractState::Ready {
                    bridge_version: bridge_version.clone(),
                },
                Contract::Incompatible { message, .. } => ContractState::Incompatible {
                    message: message.clone(),
                },
            },
        }
    }

    /// The sessions the inbox shows: each backend's newest, with what a view of each knows live.
    /// `loaded` once every backend's first page arrived.
    pub(crate) fn inbox_rows(&self) -> (bool, Vec<super::InboxSource>) {
        let lists = &self.catalog.lists;
        let rows = self
            .catalog
            .inbox
            .iter()
            .filter_map(|(_, id)| lists.get(*id))
            .flat_map(|list| list.rows())
            .take(MAX_PAGE_LIMIT * self.catalog.inbox.len())
            .map(|row| super::InboxSource {
                live: self.streams.live_info(&row.session),
                row: row.clone(),
            })
            .collect();
        (self.inbox_loaded(), rows)
    }
}

pub(crate) struct Shared {
    session: Session,
    runtime: LinkRuntime,
    client: ClientInfo,
    state: Mutex<State>,
    inbox: Arc<Notify>,
}

impl Shared {
    pub(crate) fn new(
        session: Session,
        runtime: LinkRuntime,
        client: ClientInfo,
        record: MachineRecord,
        inbox: Arc<Notify>,
    ) -> Shared {
        let state = State {
            record,
            link: session.status(),
            bridge: None,
            contract: Contract::Waiting,
            ended: None,
            requests: Requests::default(),
            streams: Streams::default(),
            terminals: Terminals::default(),
            catalog: Catalog::default(),
            events: MachineEvents::default(),
        };
        Shared {
            session,
            runtime,
            client,
            state: Mutex::new(state),
            inbox,
        }
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn runtime(&self) -> &LinkRuntime {
        &self.runtime
    }

    pub(crate) fn session(&self) -> &Session {
        &self.session
    }

    pub(crate) fn client(&self) -> &ClientInfo {
        &self.client
    }

    pub(crate) fn poke_inbox(&self) {
        self.inbox.notify_one();
    }

    /// `act` on the machine's state after `pause`, unless the machine has gone by then.
    pub(crate) fn later(
        self: &Arc<Self>,
        pause: Duration,
        act: impl FnOnce(&Arc<Shared>, &mut State) + Send + 'static,
    ) {
        let shared = Arc::downgrade(self);
        self.runtime.handle().spawn(async move {
            tokio::time::sleep(pause).await;
            if let Some(shared) = shared.upgrade() {
                act(&shared, &mut shared.lock());
            }
        });
    }

    /// A caller's request, its answer still to be awaited.
    pub(crate) fn call(&self, message: ClientMessage) -> Result<Call<'_>, ClientError> {
        self.call_until(message, requests::deadline())
    }

    pub(crate) fn call_until(
        &self,
        message: ClientMessage,
        deadline: Instant,
    ) -> Result<Call<'_>, ClientError> {
        let (sender, receiver) = oneshot::channel();
        let id = self.submit(&mut self.lock(), message, Waiter::Caller(sender))?;
        Ok(Call {
            shared: self,
            id,
            receiver,
            deadline,
        })
    }

    /// One request and its answer. A request the bridge's rate limit refused was not served, so it
    /// goes again after the pause, within the same deadline.
    pub(crate) async fn request(
        &self,
        message: ClientMessage,
    ) -> Result<ServerMessage, ClientError> {
        if wire::managed(&message) {
            return Err(ClientError::InvalidRequest {
                detail: "hello, attaches and detaches are the client's own: use a view".to_owned(),
            });
        }
        let deadline = requests::deadline();
        loop {
            let answer = self.call_until(message.clone(), deadline)?.answer().await;
            let again = Instant::now() + RATE_LIMIT_PAUSE;
            match answer {
                Err(ClientError::Refused {
                    code: ProtocolErrorCode::RateLimited,
                    ..
                }) if again < deadline => wait::until(&self.runtime, again).await,
                answer => return answer,
            }
        }
    }

    /// Registers a request and sends it, or holds it behind the others until the bridge is ready.
    fn submit(
        &self,
        state: &mut State,
        message: ClientMessage,
        waiter: Waiter,
    ) -> Result<u64, ClientError> {
        if let Some(error) = &state.ended {
            return Err(error.clone());
        }
        if let Contract::Incompatible { message, .. } = &state.contract {
            return Err(ClientError::Incompatible {
                detail: message.clone(),
            });
        }
        if state.requests.callers() >= MAX_PENDING_REQUESTS {
            return Err(ClientError::Overloaded);
        }
        let id = state.requests.mint();
        let frame = wire::frame(&wire::stamped(message, &id.to_string()));
        if state.contract.ready() && !state.requests.has_held() {
            self.send(id, frame)
                .map_err(|failure| ClientError::NotSent { failure })?;
            state.requests.insert(id, waiter, None);
        } else {
            state.requests.insert(id, waiter, Some(frame));
        }
        Ok(id)
    }

    /// A request of the client's own, on a bridge that is ready; `Ok(false)` when it is not. With no
    /// waiter its answer reaches nobody.
    pub(crate) fn send_ready(
        &self,
        state: &mut State,
        message: ClientMessage,
        waiter: Option<Waiter>,
    ) -> Result<bool, SendFailure> {
        if !state.contract.ready() || state.ended.is_some() {
            return Ok(false);
        }
        self.send_unchecked(state, message, waiter)?;
        Ok(true)
    }

    /// Nothing waits for a detach: if the bridge never had the view attached it says so, and that
    /// changes nothing here.
    pub(crate) fn detach(&self, state: &mut State, detach: ClientMessage) {
        if let Err(failure) = self.send_ready(state, detach, None::<Waiter>) {
            tracing::debug!(?failure, "a detach was not sent");
        }
    }

    pub(crate) fn send_unchecked(
        &self,
        state: &mut State,
        message: ClientMessage,
        waiter: Option<Waiter>,
    ) -> Result<(), SendFailure> {
        let id = state.requests.mint();
        self.send(id, wire::frame(&wire::stamped(message, &id.to_string())))?;
        if let Some(waiter) = waiter {
            state.requests.insert(id, waiter, None);
        }
        Ok(())
    }

    pub(crate) fn send(&self, id: u64, frame: Vec<u8>) -> Result<(), SendFailure> {
        self.session.send_bridge(frame, Some(id.to_string()))
    }
}

/// A request sent or held; dropping it before the answer stops waiting for one.
pub(crate) struct Call<'a> {
    shared: &'a Shared,
    id: u64,
    receiver: oneshot::Receiver<Answer>,
    deadline: Instant,
}

impl Call<'_> {
    /// The answer, with the bridge's `error{…}` as an error.
    pub(crate) async fn answer(mut self) -> Result<ServerMessage, ClientError> {
        let deadline = self.deadline;
        let runtime = self.shared.runtime.clone();
        match wait::within(&runtime, deadline, &mut self.receiver).await {
            None => Err(ClientError::Timeout),
            Some(Err(_)) => Err(ClientError::Closed),
            Some(Ok(Ok(ServerMessage::Error(error)))) => Err(match error.error.code {
                ProtocolErrorCode::UnsupportedVersion => ClientError::Incompatible {
                    detail: error.error.message,
                },
                code => ClientError::Refused {
                    code,
                    detail: error.error.message,
                },
            }),
            Some(Ok(answer)) => answer,
        }
    }
}

impl Drop for Call<'_> {
    fn drop(&mut self) {
        self.shared.lock().requests.remove(self.id);
    }
}
