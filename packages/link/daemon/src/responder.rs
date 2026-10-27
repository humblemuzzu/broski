use std::sync::Arc;
use std::time::Duration;

use broski_link_core::crypto::{HandshakeModeKind, StaticIdentity};
use broski_link_core::Accepted;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;
use tracing::{debug, info, warn};
use zeroize::Zeroizing;

use crate::clock;
use crate::conn::Conn;
use crate::device::{short, DeviceRecord};
use crate::offers::Offers;
use crate::registry::Registry;
use crate::relay::RelayHandle;
use crate::session::{SessionCommand, SessionDeps};
use crate::store::Store;

const ATTACH_TIMEOUT: Duration = Duration::from_secs(10);
/// How long one wire unit waits for room in the session's command queue. A phone that keeps
/// sending while the session is slow is a reason to wait, not to drop its connection; only a
/// session that has not moved a single command in this long ends it.
const COMMAND_WAIT: Duration = Duration::from_secs(10);

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
        let Ok(Some(first)) = timeout(self.deps.handshake_timeout, conn.inbound.recv()).await
        else {
            debug!(route, "no handshake inside the handshake window");
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

/// Waits for room instead of dropping the connection when the session's queue is full; only a
/// session that has stopped draining it ends the connection.
async fn pump(conn: &mut Conn, commands: &mpsc::Sender<SessionCommand>) {
    let conn_id = conn.id;
    while let Some(wire) = conn.inbound.recv().await {
        let command = SessionCommand::Wire {
            conn: conn_id,
            bytes: wire,
        };
        match timeout(COMMAND_WAIT, commands.send(command)).await {
            Ok(Ok(())) => {}
            Ok(Err(_)) => return,
            Err(_) => {
                warn!(
                    conn = conn_id,
                    "the session is not taking commands; ending the connection"
                );
                break;
            }
        }
    }
    let lost = SessionCommand::Lost { conn: conn_id };
    if timeout(COMMAND_WAIT, commands.send(lost)).await.is_err() {
        debug!(
            conn = conn_id,
            "the session never learned this connection ended"
        );
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use crate::conn::{self, Route};

    use super::*;

    /// A burst bigger than the session's command queue: the phone's own messages must all reach
    /// the session, in order, instead of the connection being dropped when the queue fills.
    #[tokio::test]
    async fn a_burst_larger_than_the_command_queue_arrives_whole() {
        const BURST: usize = 200;
        let (commands, mut session) = mpsc::channel(4);
        let parts = conn::channel(Route::Lan, None);
        let mut conn = parts.conn;
        let inbound = parts.inbound_tx;
        let burst = tokio::spawn(async move {
            for index in 0..BURST {
                if inbound.send(vec![index as u8]).await.is_err() {
                    break;
                }
            }
            drop(inbound);
        });
        let pumped = tokio::spawn(async move { pump(&mut conn, &commands).await });
        // The session is busy elsewhere: by the time it reads again every queue between the phone
        // and it is full.
        tokio::time::sleep(Duration::from_millis(100)).await;

        let mut seen = Vec::new();
        while let Some(command) = session.recv().await {
            match command {
                SessionCommand::Wire { bytes, .. } => seen.push(bytes[0] as usize),
                SessionCommand::Lost { .. } => break,
                _ => {}
            }
        }
        burst.await.expect("the phone sends");
        pumped.await.expect("the pump ends");
        assert_eq!(
            seen,
            (0..BURST).collect::<Vec<usize>>(),
            "the connection dropped or reordered the burst"
        );
    }
}
