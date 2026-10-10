use std::sync::Arc;
use std::time::Duration;

use broski_link_core::crypto::{HandshakeModeKind, StaticIdentity};
use broski_link_core::Accepted;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use tracing::{debug, info};
use zeroize::Zeroizing;

use crate::clock;
use crate::conn::Conn;
use crate::device::{short, DeviceRecord};
use crate::offers::Offers;
use crate::registry::Registry;
use crate::relay::RelayHandle;
use crate::session::{SessionCommand, SessionDeps};
use crate::store::Store;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const ATTACH_TIMEOUT: Duration = Duration::from_secs(10);

/// The Noise responder for every new network connection, LAN or relay channel.
pub struct Responder {
    pub identity: Arc<StaticIdentity>,
    pub store: Arc<Store>,
    pub offers: Arc<Offers>,
    pub registry: Arc<Registry>,
    pub relay: RelayHandle,
    pub deps: Arc<SessionDeps>,
}

impl Responder {
    pub async fn run(&self, mut conn: Conn) {
        let route = conn.route.name();
        let Ok(Some(first)) = timeout(HANDSHAKE_TIMEOUT, conn.inbound.recv()).await else {
            return;
        };
        let accepted = match self
            .offers
            .accept(&self.identity, &first, clock::unix_secs())
            .await
        {
            Ok(accepted) => accepted,
            Err(error) => {
                debug!(route, error = %error, "handshake not accepted");
                return;
            }
        };
        let Some((device, paired, pairing_revoke)) = self.resolve(&conn, &accepted).await else {
            return;
        };

        let commands = self.registry.get_or_spawn(&device, self.deps.clone());
        let (reply, attached) = oneshot::channel();
        let command = SessionCommand::Accept {
            accepted: Box::new(accepted),
            sender: conn.sender.clone(),
            paired,
            pairing_revoke,
            reply,
        };
        if commands.send(command).await.is_err() {
            return;
        }
        if timeout(ATTACH_TIMEOUT, attached).await.is_err() {
            return;
        }
        pump(&mut conn, &commands).await;
    }

    /// The device this handshake belongs to, its relay token when the handshake pairs, and the
    /// pairing device the session must revoke once the pairing reply is on the wire.
    async fn resolve(
        &self,
        conn: &Conn,
        accepted: &Accepted,
    ) -> Option<(DeviceRecord, Option<Zeroizing<String>>, Option<String>)> {
        let route = conn.route.name();
        let pairing_device = conn.device.clone();
        let pairing = pairing_device
            .as_deref()
            .is_some_and(|device| self.offers.is_pairing_device(device));
        if pairing && accepted.mode == HandshakeModeKind::Connect {
            debug!(route, "the pairing device may only pair, never connect");
            return None;
        }
        let revoke = if pairing { pairing_device } else { None };
        match accepted.mode {
            HandshakeModeKind::Pair => {
                let Ok(Some((record, token))) = self.store.pair_device(&accepted.peer).await else {
                    debug!(route, "pairing refused: the device limit is reached");
                    return None;
                };
                self.relay.refresh();
                info!(device = short(&record.id), "device paired");
                Some((record, Some(token), revoke))
            }
            HandshakeModeKind::Connect => {
                let Some(record) = self.store.device(&accepted.peer.id()).await else {
                    debug!(route, "unknown device dropped without a reply");
                    return None;
                };
                Some((record, None, None))
            }
        }
    }
}

async fn pump(conn: &mut Conn, commands: &mpsc::Sender<SessionCommand>) {
    let conn_id = conn.id;
    while let Some(wire) = conn.inbound.recv().await {
        if commands
            .try_send(SessionCommand::Wire {
                conn: conn_id,
                bytes: wire,
            })
            .is_err()
        {
            break;
        }
    }
    let _ = commands.try_send(SessionCommand::Lost { conn: conn_id });
}
