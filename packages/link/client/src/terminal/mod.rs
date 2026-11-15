//! Terminal views: a terminal's raw output for the phone's VT emulator, and its input and resizes
//! back, attached across links that start over without missing or repeating a byte.

pub(crate) mod state;
#[cfg(test)]
mod state_tests;

use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use broski_contract::{
    ActionResult, ClientMessage, ServerMessage, TermInputRequest, TermResizeRequest, TerminalId,
    TerminalSummary, MAX_TERMINAL_INPUT_BYTES,
};

use self::state::TakeOutput;
use crate::error::ClientError;
use crate::machine::Machine;
use crate::wait;

/// What a terminal view hands the UI, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalUpdate {
    /// Bytes the terminal wrote, following the previous update's with nothing missing or repeated.
    /// `reset`: clear the emulator first. The first output of a view has it, and so does a reattach
    /// after the bridge no longer held everything this phone missed (its replay keeps the newest
    /// `MAX_TERMINAL_OUTPUT_BYTES`); a resize then has a full-screen program redraw.
    Output { data: Vec<u8>, reset: bool },
    /// The terminal's process ended; nothing follows.
    Exited {
        exit_code: Option<i64>,
        signal: Option<String>,
    },
    /// The bridge would not attach the terminal, or the machine went away; nothing follows.
    Failed { message: String },
}

/// One screen's view of a terminal. Opening another view of the same terminal ends this one.
pub struct TerminalView {
    machine: Arc<Machine>,
    key: u64,
    id: TerminalId,
}

impl TerminalView {
    pub(crate) fn new(machine: Arc<Machine>, key: u64, id: TerminalId) -> TerminalView {
        TerminalView { machine, key, id }
    }

    pub fn id(&self) -> TerminalId {
        self.id.clone()
    }

    /// The next update; `None` after the last. One reader at a time.
    pub async fn next_update(&self) -> Option<TerminalUpdate> {
        loop {
            let take = self.machine.shared().lock().terminals.take(self.key);
            match take {
                TakeOutput::Update(update) => return Some(update),
                TakeOutput::Finished => return None,
                TakeOutput::Wait(notify) => {
                    wait::notified(self.machine.shared().runtime(), &notify, None).await;
                }
            }
        }
    }

    /// The terminal as the bridge last described it.
    pub fn summary(&self) -> Option<TerminalSummary> {
        let state = self.machine.shared().lock();
        state.terminals.get(self.key)?.summary().cloned()
    }

    /// Key bytes as the emulator encoded them. They reach the terminal in the order sent; more than
    /// `MAX_TERMINAL_INPUT_BYTES` go as several requests, the first refusal answering for all.
    pub async fn input(&self, data: Vec<u8>) -> Result<ActionResult, ClientError> {
        let calls = data
            .chunks(MAX_TERMINAL_INPUT_BYTES)
            .map(|chunk| {
                self.machine
                    .shared()
                    .call(ClientMessage::TermInput(TermInputRequest {
                        request_id: String::new(),
                        id: self.id.clone(),
                        data: STANDARD.encode(chunk),
                    }))
            })
            .collect::<Result<Vec<_>, ClientError>>()?;
        let mut last = ActionResult::Accepted(broski_contract::ActionAccepted {});
        for call in calls {
            last = match call.answer().await? {
                ServerMessage::TermInputResult(answer) => answer.result,
                other => return Err(crate::machine::unexpected(&other)),
            };
            if let ActionResult::Rejected(_) = last {
                break;
            }
        }
        Ok(last)
    }

    /// The size in cells, and in pixels when the cell size is known (contract README §20.1).
    pub async fn resize(
        &self,
        cols: i64,
        rows: i64,
        cell_width: Option<i64>,
        cell_height: Option<i64>,
    ) -> Result<ActionResult, ClientError> {
        let request = ClientMessage::TermResize(TermResizeRequest {
            request_id: String::new(),
            id: self.id.clone(),
            cols,
            rows,
            cell_width,
            cell_height,
        });
        match self.machine.shared().call(request)?.answer().await? {
            ServerMessage::TermResizeResult(answer) => Ok(answer.result),
            other => Err(crate::machine::unexpected(&other)),
        }
    }

    /// Detaches the view; dropping it does the same.
    pub fn close(&self) {
        self.machine.leave_terminal(self.key);
    }
}

impl Drop for TerminalView {
    fn drop(&mut self) {
        self.close();
    }
}
