//! Moving a relay link onto a LAN socket the probe opened, make-before-break.
//!
//! The daemon takes exactly one handshake per connection, so a relay socket that carried a session
//! can never handshake again. The relay therefore keeps carrying the session while the LAN socket
//! handshakes beside it, and is let go only once the LAN handshake has landed: a LAN address that
//! answers for another machine, or not at all, costs the link nothing.

use tokio::time::Instant;
use tracing::debug;

use super::{Engine, Migration};
use crate::transport::Socket;

impl Engine {
    pub(super) fn migrate(&mut self, socket: Socket) {
        if !self.link.is_connected() {
            // Nothing is carried yet, so there is nothing to keep: the LAN socket simply takes over.
            self.current = Some(socket);
            self.attach();
            return;
        }
        let msg1 = match self.link.migrate(self.identity.as_static(), &self.server) {
            Ok(msg1) => msg1,
            Err(error) => {
                debug!(%error, "no migration");
                return;
            }
        };
        if socket.out().is_some_and(|out| out.try_send(msg1).is_ok()) {
            let reply_by = Instant::now() + self.options.timings.handshake_timeout;
            self.migration = Some(Migration { socket, reply_by });
        } else {
            self.link.abandon_migration();
        }
    }

    /// msg2 on the LAN socket: the session moves onto it and the relay socket is closed. Frames
    /// still waiting for the relay's writer were sealed for that connection; the resume sends their
    /// content again on the new one.
    pub(super) fn complete_migration(&mut self, msg2: &[u8]) {
        let Some(migration) = self.migration.take() else {
            return;
        };
        if let Err(error) = self.link.complete_migration(msg2, self.now_ms()) {
            debug!(%error, "migration failed; the relay keeps the link");
            return;
        }
        self.current = Some(migration.socket);
        self.pending_wire = None;
        self.drain_link();
    }

    pub(super) fn abandon_migration(&mut self) {
        self.link.abandon_migration();
        self.migration = None;
    }
}
