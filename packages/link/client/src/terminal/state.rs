//! One terminal this phone views: where its output stands, the bytes not handed to the UI yet, and
//! how it ended (contract README §20.2).

use std::collections::HashMap;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use broski_contract::{
    ClientMessage, ServerMessage, TermAttachRequest, TermAttachResult, TermDetachRequest,
    TermExitedMessage, TermOutputMessage, TerminalAttached, TerminalId, TerminalStatus,
    TerminalSummary, MAX_TERMINALS, MAX_TERMINAL_OUTPUT_BYTES,
};
use tokio::sync::Notify;
use tokio::time::Instant;

use super::TerminalUpdate;
use crate::attach::{AttachRetry, Next};
use crate::error::ClientError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Detached,
    Attaching,
    Attached,
    /// Exited or refused: nothing attaches again.
    Done,
}

pub(crate) enum TakeOutput {
    Update(TerminalUpdate),
    Wait(Arc<Notify>),
    Finished,
}

pub(crate) struct TerminalState {
    id: TerminalId,
    phase: Phase,
    summary: Option<TerminalSummary>,
    attached_once: bool,
    /// The output offset just past the last byte received, kept or not: the bridge's own count.
    received: i64,
    /// The newest bytes not handed to the UI yet, at most `MAX_TERMINAL_OUTPUT_BYTES`.
    pending: Vec<u8>,
    /// The UI clears its emulator before the pending bytes.
    reset: bool,
    exit: Option<TerminalUpdate>,
    finished: bool,
    notify: Arc<Notify>,
    retry: AttachRetry,
}

impl TerminalState {
    fn new(id: TerminalId) -> TerminalState {
        TerminalState {
            id,
            phase: Phase::Detached,
            summary: None,
            attached_once: false,
            received: 0,
            pending: Vec::new(),
            reset: false,
            exit: None,
            finished: false,
            notify: Arc::new(Notify::new()),
            retry: AttachRetry::default(),
        }
    }

    pub(crate) fn summary(&self) -> Option<&TerminalSummary> {
        self.summary.as_ref()
    }

    pub(crate) fn needs_attach(&self) -> bool {
        self.phase == Phase::Detached
    }

    /// From the first byte not received; the first attach asks for everything the bridge holds.
    pub(crate) fn attach_request(&mut self) -> ClientMessage {
        self.phase = Phase::Attaching;
        ClientMessage::TermAttach(TermAttachRequest {
            request_id: String::new(),
            id: self.id.clone(),
            since: self.attached_once.then_some(self.received),
        })
    }

    /// The bridge socket in use is gone; the next one gets the whole retry window again.
    pub(crate) fn detached(&mut self) {
        if matches!(self.phase, Phase::Attaching | Phase::Attached) {
            self.phase = Phase::Detached;
        }
        self.retry.succeeded();
    }

    /// The link did not send the attach: it goes again after a pause, until the retry window ends.
    pub(crate) fn not_sent(&mut self, why: String, now: Instant) -> Next {
        if self.phase == Phase::Done {
            return Next::Nothing;
        }
        match self.retry.failed(now) {
            Some(pause) => {
                self.phase = Phase::Detached;
                Next::AttachAfter(pause)
            }
            None => {
                self.fail(why);
                Next::Nothing
            }
        }
    }

    pub(crate) fn fail(&mut self, message: String) {
        if self.phase != Phase::Done {
            self.phase = Phase::Done;
            self.exit = Some(TerminalUpdate::Failed { message });
        }
        self.notify.notify_one();
    }

    /// As a session view's: a refusal that may pass is tried again after a pause that grows, the
    /// output already handed over staying; the terminal's own rejection ends the view.
    pub(crate) fn on_attach_answer(&mut self, answer: ServerMessage, now: Instant) -> Next {
        if self.phase == Phase::Done {
            return Next::Nothing;
        }
        match answer {
            ServerMessage::TermAttachResult(answer) => match answer.result {
                TermAttachResult::Accepted(attached) => {
                    self.retry.succeeded();
                    self.attached(attached);
                }
                TermAttachResult::Rejected(rejected) => self.fail(rejected.rejection.message),
            },
            ServerMessage::Error(error) => match self.retry.refused(error.error.code, now) {
                Some(pause) => {
                    self.phase = Phase::Detached;
                    return Next::AttachAfter(pause);
                }
                None => self.fail(error.error.message),
            },
            other => self.fail(format!("the bridge answered the attach with {other:?}")),
        }
        Next::Nothing
    }

    /// A replay that starts where this phone asked carries exactly what it missed; one that starts
    /// later means the bridge no longer held that, and the UI starts over from what it did hold.
    fn attached(&mut self, attached: TerminalAttached) {
        let Ok(bytes) = STANDARD.decode(&attached.data) else {
            return self.fail("the bridge sent output that is not base64".to_owned());
        };
        if !self.attached_once || attached.seq != self.received {
            self.pending.clear();
            self.reset = true;
        }
        self.attached_once = true;
        self.received = attached.seq;
        self.receive(bytes);
        let terminal = attached.terminal;
        self.phase = match terminal.status {
            TerminalStatus::Running => Phase::Attached,
            TerminalStatus::Exited => {
                self.exit = Some(exited(terminal.exit_code, terminal.signal.clone()));
                Phase::Done
            }
        };
        self.summary = Some(terminal);
        self.notify.notify_one();
    }

    pub(crate) fn on_output(&mut self, output: TermOutputMessage) -> Next {
        if self.phase != Phase::Attached {
            return Next::Nothing;
        }
        let bytes = match STANDARD.decode(&output.data) {
            Ok(bytes) if output.seq == self.received => bytes,
            _ => return self.attach_again(),
        };
        self.receive(bytes);
        self.notify.notify_one();
        Next::Nothing
    }

    /// Output that follows what was received. An idle UI cannot hold more than the bridge's own
    /// replay would hand it, so the oldest bytes past that go, and the UI starts over from what is
    /// left. Nothing is asked of the bridge: `received` still counts every byte, so live output
    /// goes on in step.
    fn receive(&mut self, bytes: Vec<u8>) {
        self.received += bytes.len() as i64;
        self.pending.extend(bytes);
        let excess = self.pending.len().saturating_sub(MAX_TERMINAL_OUTPUT_BYTES);
        if excess > 0 {
            let cut = safe_trim_offset(&self.pending, excess);
            self.pending.drain(..cut);
            self.reset = true;
        }
    }

    /// The machine sends an attach only for a detached view.
    fn attach_again(&mut self) -> Next {
        self.phase = Phase::Detached;
        Next::Attach
    }

    pub(crate) fn on_exited(&mut self, exited_message: TermExitedMessage) {
        if self.phase == Phase::Attached {
            self.phase = Phase::Done;
            self.exit = Some(exited(exited_message.exit_code, exited_message.signal));
            self.notify.notify_one();
        }
    }

    pub(crate) fn take(&mut self) -> TakeOutput {
        if self.finished {
            return TakeOutput::Finished;
        }
        if self.reset || !self.pending.is_empty() {
            let reset = std::mem::take(&mut self.reset);
            let data = std::mem::take(&mut self.pending);
            return TakeOutput::Update(TerminalUpdate::Output { data, reset });
        }
        match self.exit.take() {
            Some(end) => {
                self.finished = true;
                TakeOutput::Update(end)
            }
            None => TakeOutput::Wait(Arc::clone(&self.notify)),
        }
    }
}

fn exited(exit_code: Option<i64>, signal: Option<String>) -> TerminalUpdate {
    TerminalUpdate::Exited { exit_code, signal }
}

/// Smallest cut `>= min_drop` that neither bisects a VT escape sequence (CSI/OSC/DCS/2-byte ESC)
/// nor lands on a UTF-8 continuation byte. Bounded so malformed binary streams never drop unbounded
/// output.
fn safe_trim_offset(buf: &[u8], min_drop: usize) -> usize {
    const ESC_LOOKBACK: usize = 128;
    const ESC_MAX_SKIP: usize = 256;

    let mut cut = min_drop.min(buf.len());
    let search_start = cut.saturating_sub(ESC_LOOKBACK);
    if let Some(rel) = buf[search_start..cut].iter().rposition(|&b| b == 0x1B) {
        let esc = search_start + rel;
        if let Some(end) = escape_end(buf, esc, (cut + ESC_MAX_SKIP).min(buf.len())) {
            if end > cut {
                cut = end;
            }
        }
    }
    while cut < buf.len() && (buf[cut] & 0xC0) == 0x80 {
        cut += 1;
    }
    cut
}

/// End offset (exclusive) of the escape sequence starting at `esc`, up to `limit`, or `None` if
/// no terminator is found within `limit`.
fn escape_end(buf: &[u8], esc: usize, limit: usize) -> Option<usize> {
    let next = *buf.get(esc + 1)?;
    match next {
        // CSI: ESC [ <params/intermediates 0x20..=0x3F> <final 0x40..=0x7E>
        b'[' => {
            let mut i = esc + 2;
            while i < limit {
                let b = buf[i];
                if (0x40..=0x7E).contains(&b) {
                    return Some(i + 1);
                }
                if !(0x20..=0x3F).contains(&b) {
                    return None;
                }
                i += 1;
            }
            None
        }
        // OSC / DCS / APC / PM / SOS: terminated by BEL (0x07) or ST (ESC \).
        b']' | b'P' | b'_' | b'^' | b'X' => {
            let mut i = esc + 2;
            while i < limit {
                if buf[i] == 0x07 {
                    return Some(i + 1);
                }
                if buf[i] == 0x1B && buf.get(i + 1) == Some(&b'\\') {
                    return Some(i + 2);
                }
                i += 1;
            }
            None
        }
        // Two-byte escape or nF sequence (`ESC ( B`, etc.): skip intermediate bytes 0x20..=0x2F.
        0x20..=0x2F => {
            let mut i = esc + 2;
            while i < limit && (0x20..=0x2F).contains(&buf[i]) {
                i += 1;
            }
            (i < limit).then_some(i + 1)
        }
        _ => Some((esc + 2).min(buf.len())),
    }
}

/// The terminals this phone views, one view each.
#[derive(Default)]
pub(crate) struct Terminals {
    next: u64,
    views: HashMap<u64, TerminalState>,
}

impl Terminals {
    /// A view of `id`, which the caller then attaches; a view already open on it is ended, since the
    /// bridge keeps one attachment per terminal for this phone.
    pub(crate) fn open(&mut self, id: TerminalId) -> Result<u64, ClientError> {
        if let Some(key) = self.key_of(&id) {
            if let Some(mut replaced) = self.views.remove(&key) {
                replaced.finished = true;
                replaced.notify.notify_one();
            }
        }
        if self.views.len() >= MAX_TERMINALS {
            return Err(ClientError::InvalidRequest {
                detail: format!("a phone views at most {MAX_TERMINALS} terminals"),
            });
        }
        self.next += 1;
        self.views.insert(self.next, TerminalState::new(id));
        Ok(self.next)
    }

    /// The view goes; the detach to send when the bridge has it attached.
    pub(crate) fn close(&mut self, key: u64) -> Option<ClientMessage> {
        let state = self.views.remove(&key)?;
        state.notify.notify_one();
        matches!(state.phase, Phase::Attaching | Phase::Attached).then(|| {
            ClientMessage::TermDetach(TermDetachRequest {
                request_id: String::new(),
                id: state.id,
            })
        })
    }

    pub(crate) fn get_mut(&mut self, key: u64) -> Option<&mut TerminalState> {
        self.views.get_mut(&key)
    }

    pub(crate) fn get(&self, key: u64) -> Option<&TerminalState> {
        self.views.get(&key)
    }

    fn key_of(&self, id: &TerminalId) -> Option<u64> {
        self.views
            .iter()
            .find(|(_, state)| &state.id == id)
            .map(|(key, _)| *key)
    }

    pub(crate) fn of_terminal(&mut self, id: &TerminalId) -> Option<(u64, &mut TerminalState)> {
        let key = self.key_of(id)?;
        self.views.get_mut(&key).map(|state| (key, state))
    }

    pub(crate) fn keys(&self) -> Vec<u64> {
        self.views.keys().copied().collect()
    }

    pub(crate) fn each(&mut self, act: impl FnMut(&mut TerminalState)) {
        self.views.values_mut().for_each(act);
    }

    pub(crate) fn take(&mut self, key: u64) -> TakeOutput {
        self.views
            .get_mut(&key)
            .map_or(TakeOutput::Finished, TerminalState::take)
    }
}
