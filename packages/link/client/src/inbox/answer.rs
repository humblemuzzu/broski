//! Answering a row's pending ask with one of the options it offers, which the person tapped.

use broski_contract::{
    ActionResult, ClientMessage, InteractionAnswer, InteractionAnswerRequest, InteractionReply,
    RejectionCode, ServerMessage, SessionRef, ToolPermissionReply,
};

use super::Inbox;
use crate::error::ClientError;
use crate::machine::unexpected;

/// How the bridge took an answer from the inbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnswerOutcome {
    Accepted,
    /// The ask was answered, withdrawn or replaced before this answer reached it: "Already
    /// answered elsewhere".
    Stale,
    Rejected {
        code: RejectionCode,
        detail: String,
    },
}

impl Inbox {
    /// Answers the pending ask of `session` on `machine_id` with `option_id`, which must be the
    /// row's `pending.allow` or `pending.deny`. An ask that is no longer the session's first pending
    /// one is `Stale` without asking the bridge, and so is one whose session the inbox stopped
    /// viewing, which it does once the row stops waiting.
    pub async fn answer(
        &self,
        machine_id: String,
        session: SessionRef,
        interaction_id: String,
        option_id: String,
    ) -> Result<AnswerOutcome, ClientError> {
        let machine = self
            .machine(&machine_id)
            .ok_or_else(|| ClientError::InvalidRequest {
                detail: format!("no machine {machine_id}"),
            })?;
        let live = machine.shared().lock().streams.live_info(&session);
        let pending = live.and_then(|live| live.pending);
        let Some(pending) = pending.filter(|pending| pending.interaction_id == interaction_id)
        else {
            return Ok(AnswerOutcome::Stale);
        };
        let offered = [pending.allow, pending.deny]
            .into_iter()
            .flatten()
            .any(|option| option.id == option_id);
        if !offered {
            return Err(ClientError::InvalidRequest {
                detail: format!("{option_id} is not an option the row offers"),
            });
        }
        let request = ClientMessage::InteractionAnswer(InteractionAnswerRequest {
            request_id: String::new(),
            session,
            answer: InteractionAnswer {
                interaction_id,
                reply: InteractionReply::ToolPermission(ToolPermissionReply {
                    option_id,
                    message: None,
                    edited_input: None,
                    grant_ids: Vec::new(),
                }),
            },
        });
        match machine.request(request).await? {
            ServerMessage::InteractionAnswerResult(answer) => Ok(outcome(answer.result)),
            other => Err(unexpected(&other)),
        }
    }
}

fn outcome(result: ActionResult) -> AnswerOutcome {
    match result {
        ActionResult::Accepted(_) => AnswerOutcome::Accepted,
        ActionResult::Rejected(rejected) if rejected.rejection.code == RejectionCode::Stale => {
            AnswerOutcome::Stale
        }
        ActionResult::Rejected(rejected) => AnswerOutcome::Rejected {
            code: rejected.rejection.code,
            detail: rejected.rejection.message,
        },
    }
}
