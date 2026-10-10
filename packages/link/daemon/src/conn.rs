use std::sync::atomic::{AtomicU64, Ordering};

use tokio::sync::mpsc;

/// One network connection: a LAN websocket or one relay channel.
pub const QUEUE: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Route {
    Lan,
    Relay { channel: u32 },
}

impl Route {
    pub fn name(self) -> &'static str {
        match self {
            Route::Lan => "lan",
            Route::Relay { .. } => "relay",
        }
    }
}

pub enum ConnOut {
    Wire(Vec<u8>),
    /// Revoke this relay device on the machine socket, after every frame queued before it. The LAN
    /// sink drops it: only a relay channel has a machine socket behind it.
    Revoke(String),
    Close,
}

#[derive(Debug)]
pub enum SendError {
    Full(Vec<u8>),
    Closed,
}

#[derive(Clone)]
pub struct ConnSender {
    id: u64,
    route: Route,
    tx: mpsc::Sender<ConnOut>,
}

impl ConnSender {
    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn route(&self) -> Route {
        self.route
    }

    pub fn try_wire(&self, bytes: Vec<u8>) -> Result<(), SendError> {
        match self.tx.try_send(ConnOut::Wire(bytes)) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Closed(_)) => Err(SendError::Closed),
            Err(mpsc::error::TrySendError::Full(ConnOut::Wire(bytes))) => {
                Err(SendError::Full(bytes))
            }
            Err(mpsc::error::TrySendError::Full(_)) => Err(SendError::Closed),
        }
    }

    pub fn revoke(&self, device: String) -> Result<(), SendError> {
        match self.tx.try_send(ConnOut::Revoke(device)) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Closed(_)) => Err(SendError::Closed),
            Err(mpsc::error::TrySendError::Full(ConnOut::Revoke(device))) => {
                Err(SendError::Full(device.into_bytes()))
            }
            Err(mpsc::error::TrySendError::Full(_)) => Err(SendError::Closed),
        }
    }

    pub fn close(&self) {
        let _ = self.tx.try_send(ConnOut::Close);
    }
}

pub struct Conn {
    pub id: u64,
    pub route: Route,
    /// The relay device id this channel belongs to; `None` on the LAN.
    pub device: Option<String>,
    pub sender: ConnSender,
    pub inbound: mpsc::Receiver<Vec<u8>>,
}

pub struct ConnParts {
    pub conn: Conn,
    pub outbound: mpsc::Receiver<ConnOut>,
    pub inbound_tx: mpsc::Sender<Vec<u8>>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn channel(route: Route, device: Option<String>) -> ConnParts {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (outbound_tx, outbound) = mpsc::channel(QUEUE);
    let (inbound_tx, inbound) = mpsc::channel(QUEUE);
    ConnParts {
        conn: Conn {
            id,
            route,
            device,
            sender: ConnSender {
                id,
                route,
                tx: outbound_tx,
            },
            inbound,
        },
        outbound,
        inbound_tx,
    }
}
