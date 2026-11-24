use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use bytes::{BufMut, Bytes, BytesMut};
use tokio::time::Instant;

use crate::alerts::Arming;
use crate::limits::LAST_SEEN_FLUSH_MS;
use crate::protocol::{encode, machine_state, Status, ToMachine};
use crate::socket::{SocketHandle, CLOSE_CHANNEL, CLOSE_REPLACED, CLOSE_REVOKED, CLOSE_SLOW};

pub struct Room {
    state: Mutex<RoomState>,
}

struct RoomState {
    generation: u64,
    machine: Option<SocketHandle>,
    asleep: bool,
    last_seen: Option<i64>,
    last_flush: i64,
    devices: HashMap<String, DeviceEntry>,
    channels: HashMap<u32, String>,
    next_channel: u32,
    watch: bool,
    leases: usize,
    alert: Option<PendingAlert>,
    alert_timer: bool,
}

/// The offline alert waiting out its grace: the latest arming wins and moves the deadline.
struct PendingAlert {
    arming: Arming,
    due: Instant,
}

struct DeviceEntry {
    socket: SocketHandle,
    channel: Option<u32>,
    generation: u64,
}

pub struct Touch {
    pub flush: Option<i64>,
    pub woke: bool,
}

pub struct Snapshot {
    pub online: bool,
    pub asleep: bool,
    pub last_seen: Option<i64>,
}

impl Room {
    pub fn new(last_seen: Option<i64>) -> Room {
        Room {
            state: Mutex::new(RoomState {
                generation: 0,
                machine: None,
                asleep: false,
                last_seen,
                last_flush: last_seen.unwrap_or_default(),
                devices: HashMap::new(),
                channels: HashMap::new(),
                next_channel: 0,
                watch: false,
                leases: 0,
                alert: None,
                alert_timer: false,
            }),
        }
    }

    pub fn hold(&self) {
        self.state().leases += 1;
    }

    /// True when the last lease went and nobody is attached, so the hub may forget the room.
    pub fn release(&self) -> bool {
        let mut state = self.state();
        state.leases = state.leases.saturating_sub(1);
        state.leases == 0 && state.machine.is_none() && state.devices.is_empty()
    }

    fn state(&self) -> MutexGuard<'_, RoomState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn attach_machine(&self, socket: SocketHandle, last_seen: Option<i64>) -> u64 {
        let mut state = self.state();
        state.generation = state.generation.wrapping_add(1);
        let generation = state.generation;
        if let Some(previous) = state.machine.replace(socket) {
            previous.close(CLOSE_REPLACED, "replaced");
        }
        if last_seen.is_some() {
            state.last_seen = last_seen;
        }
        state.asleep = false;
        state.watch = false;
        state.channels.clear();
        for entry in state.devices.values_mut() {
            entry.channel = None;
        }
        let devices: Vec<String> = state.devices.keys().cloned().collect();
        for device in devices {
            self.open_channel(&mut state, &device);
        }
        self.notify(&state);
        generation
    }

    pub fn detach_machine(&self, generation: u64) -> Option<i64> {
        let mut state = self.state();
        if state.generation != generation {
            return None;
        }
        state.machine = None;
        state.channels.clear();
        for entry in state.devices.values_mut() {
            entry.channel = None;
        }
        self.notify(&state);
        state.last_seen
    }

    pub fn attach_device(&self, device: &str, socket: SocketHandle) -> u64 {
        let mut state = self.state();
        let generation = state
            .devices
            .get(device)
            .map(|entry| entry.generation.wrapping_add(1))
            .unwrap_or(1);
        let previous = state.devices.insert(
            device.to_owned(),
            DeviceEntry {
                socket: socket.clone(),
                channel: None,
                generation,
            },
        );
        if let Some(previous) = previous {
            if let Some(channel) = previous.channel {
                state.channels.remove(&channel);
                self.close_channel_on_machine(&state, channel);
            }
            previous.socket.close(CLOSE_REPLACED, "replaced");
        }
        let _ = socket.text(status_text(&state));
        if state.machine.is_some() {
            self.open_channel(&mut state, device);
        }
        generation
    }

    pub fn detach_device(&self, device: &str, generation: u64) {
        let mut state = self.state();
        let current = state.devices.get(device).map(|entry| entry.generation);
        if current != Some(generation) {
            return;
        }
        if let Some(entry) = state.devices.remove(device) {
            if let Some(channel) = entry.channel {
                state.channels.remove(&channel);
                self.close_channel_on_machine(&state, channel);
            }
        }
    }

    pub fn revoke_device(&self, device: &str) {
        let mut state = self.state();
        self.drop_device(&mut state, device, CLOSE_REVOKED, "revoked", false);
    }

    pub fn close_channel(&self, channel: u32) {
        let mut state = self.state();
        let Some(device) = state.channels.remove(&channel) else {
            return;
        };
        if let Some(entry) = state.devices.remove(&device) {
            entry.socket.close(CLOSE_CHANNEL, "closed by machine");
        }
    }

    pub fn sleep(&self) {
        let mut state = self.state();
        if state.machine.is_none() || state.asleep {
            return;
        }
        state.asleep = true;
        self.notify(&state);
    }

    pub fn set_watch(&self, on: bool) {
        self.state().watch = on;
    }

    pub fn watching(&self) -> bool {
        self.state().watch
    }

    /// Arms the offline alert for `due`. True when no timer is running for the room, so the caller
    /// starts one; a running timer picks up the new deadline itself.
    pub fn arm_alert(&self, arming: Arming, due: Instant) -> bool {
        let mut state = self.state();
        if !state.watch {
            return false;
        }
        state.alert = Some(PendingAlert { arming, due });
        !std::mem::replace(&mut state.alert_timer, true)
    }

    /// The deadline the timer waits for next; `None` ends the timer, atomically with arming.
    pub fn alert_due(&self) -> Option<Instant> {
        let mut state = self.state();
        let due = state.alert.as_ref().map(|alert| alert.due);
        if due.is_none() {
            state.alert_timer = false;
        }
        due
    }

    /// The alert due at `due`, when the machine is still gone or asleep and watched. An alert
    /// re-armed since is left for the timer's next wait.
    pub fn claim_alert(&self, due: Instant) -> Option<Arming> {
        let mut state = self.state();
        if state.alert.as_ref().map(|alert| alert.due) != Some(due) {
            return None;
        }
        let arming = state.alert.take()?.arming;
        let gone = match arming {
            Arming::Gone => state.machine.is_none(),
            Arming::Asleep => state.machine.is_some() && state.asleep,
        };
        if !state.watch || !gone {
            return None;
        }
        state.watch = false;
        Some(arming)
    }

    pub fn deliver_letter(&self, text: &str) -> bool {
        let state = self.state();
        let Some(machine) = state.machine.as_ref() else {
            return false;
        };
        machine.text(text.to_owned()).is_ok()
    }

    pub fn touch(&self, now_ms: i64) -> Touch {
        let mut state = self.state();
        state.last_seen = Some(now_ms);
        let woke = std::mem::take(&mut state.asleep);
        let flush = if now_ms.saturating_sub(state.last_flush) >= LAST_SEEN_FLUSH_MS {
            state.last_flush = now_ms;
            Some(now_ms)
        } else {
            None
        };
        Touch { flush, woke }
    }

    pub fn forward_from_device(&self, device: &str, payload: &Bytes) {
        let mut state = self.state();
        let Some(channel) = state.devices.get(device).and_then(|entry| entry.channel) else {
            return;
        };
        let Some(machine) = state.machine.as_ref() else {
            return;
        };
        let mut frame = BytesMut::with_capacity(4 + payload.len());
        frame.put_u32(channel);
        frame.put_slice(payload);
        if machine.binary(frame.freeze()).is_err() {
            let device = device.to_owned();
            self.drop_device(&mut state, &device, CLOSE_SLOW, "slow", true);
        }
    }

    pub fn forward_from_machine(&self, channel: u32, payload: Bytes) {
        let mut state = self.state();
        let Some(device) = state.channels.get(&channel) else {
            return;
        };
        let Some(entry) = state.devices.get(device) else {
            return;
        };
        if entry.socket.binary(payload).is_err() {
            let device = device.clone();
            self.drop_device(&mut state, &device, CLOSE_SLOW, "slow", true);
        }
    }

    pub fn notify_status(&self) {
        let state = self.state();
        self.notify(&state);
    }

    pub fn snapshot(&self) -> Snapshot {
        let state = self.state();
        Snapshot {
            online: state.machine.is_some(),
            asleep: state.asleep,
            last_seen: state.last_seen,
        }
    }

    pub fn close_all(&self, code: u16, reason: &'static str) {
        let state = self.state();
        if let Some(machine) = state.machine.as_ref() {
            machine.close(code, reason);
        }
        for entry in state.devices.values() {
            entry.socket.close(code, reason);
        }
    }

    fn open_channel(&self, state: &mut RoomState, device: &str) {
        let Some(machine) = state.machine.clone() else {
            return;
        };
        let channel = alloc_channel(state);
        state.channels.insert(channel, device.to_owned());
        if let Some(entry) = state.devices.get_mut(device) {
            entry.channel = Some(channel);
        }
        let _ = machine.text(encode(&ToMachine::Open {
            ch: channel,
            device,
        }));
    }

    fn close_channel_on_machine(&self, state: &RoomState, channel: u32) {
        if let Some(machine) = state.machine.as_ref() {
            let _ = machine.text(encode(&ToMachine::Close { ch: channel }));
        }
    }

    fn drop_device(
        &self,
        state: &mut RoomState,
        device: &str,
        code: u16,
        reason: &'static str,
        notify_machine: bool,
    ) {
        let Some(entry) = state.devices.remove(device) else {
            return;
        };
        if let Some(channel) = entry.channel {
            state.channels.remove(&channel);
            if notify_machine {
                self.close_channel_on_machine(state, channel);
            }
        }
        entry.socket.close(code, reason);
    }

    fn notify(&self, state: &RoomState) {
        let text = status_text(state);
        for entry in state.devices.values() {
            let _ = entry.socket.text(text.clone());
        }
    }
}

fn status_text(state: &RoomState) -> String {
    encode(&Status {
        t: "status",
        machine: machine_state(state.machine.is_some(), state.asleep),
        last_seen: state.last_seen,
    })
}

fn alloc_channel(state: &mut RoomState) -> u32 {
    loop {
        state.next_channel = state.next_channel.wrapping_add(1).max(1);
        if !state.channels.contains_key(&state.next_channel) {
            return state.next_channel;
        }
    }
}
