//! Where the machine can be reached: the record's routes, the `routes` the machine reports, the
//! LAN routes the platform discovers (`lan_search.dart`), and the LAN probe that moves a relay link
//! back onto the LAN (`lan_probe.dart`).

use std::collections::VecDeque;

use tokio::time::Instant;

use super::{Dialed, Engine, Purpose};
use crate::control::Routes;
use crate::endpoint::{lan_target, relay_target, RelayAuth, Target};
use crate::events::Event;
use crate::record::merge_lan_routes;
use crate::status::{LinkState, Route, WaitReason};

impl Engine {
    pub(super) fn lan_targets(&self) -> Vec<Target> {
        self.record
            .lan
            .iter()
            .filter_map(|route| lan_target(route))
            .collect()
    }

    /// The relay socket with this device's credentials, or the offer's one-time pairing device
    /// while a pairing waits for `paired`.
    pub(super) fn relay_target(&self) -> Option<Target> {
        let relay = self.record.relay.as_deref()?;
        let auth = match &self.pairing {
            Some(pairing) => RelayAuth {
                machine_id: &self.record.id,
                device_id: &pairing.relay.device_id,
                token: &pairing.relay.token,
            },
            None => RelayAuth {
                machine_id: &self.record.id,
                device_id: &self.record.device_id,
                token: self.record.relay_token.as_deref()?,
            },
        };
        relay_target(relay, &auth)
    }

    pub(super) fn on_routes(&mut self, routes: Routes) {
        let lan = merge_lan_routes(&dialable(&routes.lan), &self.record.lan);
        if routes.relay == self.record.relay && lan == self.record.lan {
            return;
        }
        self.record.relay = routes.relay;
        self.record.lan = lan;
        self.record_changed();
        self.routes_changed(true);
    }

    /// Routes the platform's browse found. A route found again inside `lan_redial_interval` is no
    /// reason to dial again, so a chatty responder cannot spin the link.
    pub(super) fn lan_discovered(&mut self, routes: &[String]) {
        let routes = dialable(routes);
        let now = Instant::now();
        let interval = self.options.timings.lan_redial_interval;
        self.lan_seen
            .retain(|(_, at)| now.duration_since(*at) < interval);
        let fresh: Vec<String> = routes
            .iter()
            .filter(|route| !self.lan_seen.iter().any(|(seen, _)| seen == *route))
            .cloned()
            .collect();
        if fresh.is_empty() {
            return;
        }
        self.lan_seen
            .extend(fresh.into_iter().map(|route| (route, now)));
        let lan = merge_lan_routes(&routes, &self.record.lan);
        let changed = lan != self.record.lan;
        if changed {
            self.record.lan = lan;
            self.record_changed();
        }
        self.routes_changed(changed);
    }

    fn record_changed(&self) {
        if self.pairing.is_none() {
            self.shared.emit(Event::RecordChanged(self.record.clone()));
        }
    }

    /// A connected link keeps its socket and only probes; a waiting one dials the new routes now;
    /// an attempt in flight is abandoned only for routes it is not dialling.
    fn routes_changed(&mut self, changed: bool) {
        match self.reporter.state() {
            LinkState::Connected { .. } => self.sync_probe(),
            LinkState::Waiting(
                WaitReason::Retry | WaitReason::Paused | WaitReason::RelayRefused,
            ) => self.reconnect_now(),
            _ if changed => self.reconnect_now(),
            _ => self.sync_probe(),
        }
    }

    /// Probes the LAN while the relay carries the link, and stops the moment it does not.
    pub(super) fn sync_probe(&mut self) {
        let relay = self.current.as_ref().map(|socket| socket.route) == Some(Route::Relay);
        let eligible = !self.finished && !self.pause.paused() && relay;
        self.probe.hosts = if eligible {
            self.lan_targets()
        } else {
            Vec::new()
        };
        if self.probe.hosts.is_empty() {
            self.probe.running = None;
            self.probe.policy.resume(Instant::now());
        }
    }

    pub(super) fn probe_armed(&self) -> bool {
        !self.probe.hosts.is_empty() && self.probe.running.is_none() && self.migration.is_none()
    }

    pub(super) fn start_probe(&mut self) {
        if !self.probe.policy.start(Instant::now()) {
            return;
        }
        let generation = self.next_id();
        self.probe.running = Some((
            generation,
            self.probe.hosts.iter().cloned().collect::<VecDeque<_>>(),
        ));
        self.probe_next();
    }

    fn probe_next(&mut self) {
        let Some((generation, queue)) = self.probe.running.as_mut() else {
            return;
        };
        let generation = *generation;
        match queue.pop_front() {
            Some(target) => {
                let within = self.options.timings.probe_timeout;
                self.spawn_dial(generation, Purpose::Probe, target, within);
            }
            None => {
                self.probe.running = None;
                self.probe.policy.end(Instant::now());
            }
        }
    }

    pub(super) fn probe_dialed(&mut self, dialed: Dialed) {
        let running = self
            .probe
            .running
            .as_ref()
            .map(|(generation, _)| *generation);
        if running != Some(dialed.generation) {
            return;
        }
        match dialed.result {
            Ok(stream) => {
                self.probe.running = None;
                self.probe.policy.end(Instant::now());
                let socket = self.open_socket(&dialed.target, stream);
                self.migrate(socket);
            }
            Err(_) => self.probe_next(),
        }
    }
}

/// Only routes the session would dial are worth keeping: an advert naming a host off the private
/// network is spoofed or useless, and must not crowd real routes out of the record's history.
fn dialable(routes: &[String]) -> Vec<String> {
    routes
        .iter()
        .filter(|route| lan_target(route).is_some())
        .cloned()
        .collect()
}
