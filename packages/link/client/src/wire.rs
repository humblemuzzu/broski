//! The contract on the link: request ids in, the request an answer belongs to out. Both matches are
//! exhaustive, so a message the contract adds does not compile until it is placed here.

use broski_contract::{decode_frame, encode_frame, ClientMessage, ServerMessage};

/// `message` with its `requestId` replaced by `id`: the client numbers every request it sends.
pub(crate) fn stamped(mut message: ClientMessage, id: &str) -> ClientMessage {
    let slot = match &mut message {
        ClientMessage::Hello(request) => &mut request.request_id,
        ClientMessage::BackendsList(request) => &mut request.request_id,
        ClientMessage::BackendStatus(request) => &mut request.request_id,
        ClientMessage::ModelsList(request) => &mut request.request_id,
        ClientMessage::CommandsList(request) => &mut request.request_id,
        ClientMessage::ModesList(request) => &mut request.request_id,
        ClientMessage::SessionsList(request) => &mut request.request_id,
        ClientMessage::SessionGet(request) => &mut request.request_id,
        ClientMessage::SessionCreate(request) => &mut request.request_id,
        ClientMessage::SessionFork(request) => &mut request.request_id,
        ClientMessage::SessionRename(request) => &mut request.request_id,
        ClientMessage::SessionDelete(request) => &mut request.request_id,
        ClientMessage::SessionAttach(request) => &mut request.request_id,
        ClientMessage::SessionDetach(request) => &mut request.request_id,
        ClientMessage::TranscriptRead(request) => &mut request.request_id,
        ClientMessage::AttachmentRead(request) => &mut request.request_id,
        ClientMessage::Prompt(request) => &mut request.request_id,
        ClientMessage::Abort(request) => &mut request.request_id,
        ClientMessage::InteractionAnswer(request) => &mut request.request_id,
        ClientMessage::QueueCancel(request) => &mut request.request_id,
        ClientMessage::ModelSet(request) => &mut request.request_id,
        ClientMessage::ThinkingSet(request) => &mut request.request_id,
        ClientMessage::ModeSet(request) => &mut request.request_id,
        ClientMessage::Compact(request) => &mut request.request_id,
        ClientMessage::PlanUsage(request) => &mut request.request_id,
        ClientMessage::StatsSummary(request) => &mut request.request_id,
        ClientMessage::WorkspaceInfo(request) => &mut request.request_id,
        ClientMessage::FsList(request) => &mut request.request_id,
        ClientMessage::FsRead(request) => &mut request.request_id,
        ClientMessage::FsImage(request) => &mut request.request_id,
        ClientMessage::FsSearch(request) => &mut request.request_id,
        ClientMessage::GitStatus(request) => &mut request.request_id,
        ClientMessage::GitDiff(request) => &mut request.request_id,
        ClientMessage::GitStage(request) => &mut request.request_id,
        ClientMessage::GitUnstage(request) => &mut request.request_id,
        ClientMessage::GitCommit(request) => &mut request.request_id,
        ClientMessage::GitBranches(request) => &mut request.request_id,
        ClientMessage::GitCheckout(request) => &mut request.request_id,
        ClientMessage::GitLog(request) => &mut request.request_id,
        ClientMessage::TermList(request) => &mut request.request_id,
        ClientMessage::TermOpen(request) => &mut request.request_id,
        ClientMessage::TermAttach(request) => &mut request.request_id,
        ClientMessage::TermDetach(request) => &mut request.request_id,
        ClientMessage::TermInput(request) => &mut request.request_id,
        ClientMessage::TermResize(request) => &mut request.request_id,
        ClientMessage::TermClose(request) => &mut request.request_id,
    };
    id.clone_into(slot);
    message
}

/// The requests whose effects the client keeps track of itself (the version agreed on, which
/// sessions and terminals this phone views), so they go through `Machine` and its views only.
pub(crate) fn managed(message: &ClientMessage) -> bool {
    matches!(
        message,
        ClientMessage::Hello(_)
            | ClientMessage::SessionAttach(_)
            | ClientMessage::SessionDetach(_)
            | ClientMessage::TermAttach(_)
            | ClientMessage::TermDetach(_)
    )
}

/// The requests the client sends again after the bridge socket they went out on was lost before
/// their answer came: reads, values set outright, and prompts, which the bridge takes once per
/// `clientRequestId` (contract README §10). One that acts each time it arrives is never repeated:
/// the first may have been served.
pub(crate) fn repeatable(message: &ClientMessage) -> bool {
    match message {
        ClientMessage::BackendsList(_)
        | ClientMessage::BackendStatus(_)
        | ClientMessage::ModelsList(_)
        | ClientMessage::CommandsList(_)
        | ClientMessage::ModesList(_)
        | ClientMessage::SessionsList(_)
        | ClientMessage::SessionGet(_)
        | ClientMessage::TranscriptRead(_)
        | ClientMessage::AttachmentRead(_)
        | ClientMessage::PlanUsage(_)
        | ClientMessage::StatsSummary(_)
        | ClientMessage::WorkspaceInfo(_)
        | ClientMessage::FsList(_)
        | ClientMessage::FsRead(_)
        | ClientMessage::FsImage(_)
        | ClientMessage::FsSearch(_)
        | ClientMessage::GitStatus(_)
        | ClientMessage::GitDiff(_)
        | ClientMessage::GitBranches(_)
        | ClientMessage::GitLog(_)
        | ClientMessage::TermList(_)
        | ClientMessage::Prompt(_)
        | ClientMessage::SessionRename(_)
        | ClientMessage::ModelSet(_)
        | ClientMessage::ThinkingSet(_)
        | ClientMessage::ModeSet(_)
        | ClientMessage::GitStage(_)
        | ClientMessage::GitUnstage(_)
        | ClientMessage::TermResize(_) => true,
        ClientMessage::Hello(_)
        | ClientMessage::SessionAttach(_)
        | ClientMessage::SessionDetach(_)
        | ClientMessage::SessionCreate(_)
        | ClientMessage::SessionFork(_)
        | ClientMessage::SessionDelete(_)
        | ClientMessage::Abort(_)
        | ClientMessage::InteractionAnswer(_)
        | ClientMessage::QueueCancel(_)
        | ClientMessage::Compact(_)
        | ClientMessage::GitCommit(_)
        | ClientMessage::GitCheckout(_)
        | ClientMessage::TermOpen(_)
        | ClientMessage::TermAttach(_)
        | ClientMessage::TermDetach(_)
        | ClientMessage::TermInput(_)
        | ClientMessage::TermClose(_) => false,
    }
}

/// What a message from the bridge is: the answer to one request, or news nobody asked for.
pub(crate) enum Incoming {
    Answer(String, ServerMessage),
    /// An `error` that names no request: the bridge could not read one this phone sent.
    Unattributed(ServerMessage),
    Pushed(ServerMessage),
}

pub(crate) fn classify(message: ServerMessage) -> Incoming {
    let id = match &message {
        ServerMessage::HelloResult(answer) => &answer.request_id,
        ServerMessage::BackendsListResult(answer) => &answer.request_id,
        ServerMessage::BackendStatusResult(answer) => &answer.request_id,
        ServerMessage::ModelsListResult(answer) => &answer.request_id,
        ServerMessage::CommandsListResult(answer) => &answer.request_id,
        ServerMessage::ModesListResult(answer) => &answer.request_id,
        ServerMessage::SessionsListResult(answer) => &answer.request_id,
        ServerMessage::SessionGetResult(answer) => &answer.request_id,
        ServerMessage::SessionCreateResult(answer) => &answer.request_id,
        ServerMessage::SessionForkResult(answer) => &answer.request_id,
        ServerMessage::SessionRenameResult(answer) => &answer.request_id,
        ServerMessage::SessionDeleteResult(answer) => &answer.request_id,
        ServerMessage::SessionAttachResult(answer) => &answer.request_id,
        ServerMessage::SessionDetachResult(answer) => &answer.request_id,
        ServerMessage::TranscriptReadResult(answer) => &answer.request_id,
        ServerMessage::AttachmentReadResult(answer) => &answer.request_id,
        ServerMessage::PromptResult(answer) => &answer.request_id,
        ServerMessage::AbortResult(answer) => &answer.request_id,
        ServerMessage::InteractionAnswerResult(answer) => &answer.request_id,
        ServerMessage::QueueCancelResult(answer) => &answer.request_id,
        ServerMessage::ModelSetResult(answer) => &answer.request_id,
        ServerMessage::ThinkingSetResult(answer) => &answer.request_id,
        ServerMessage::ModeSetResult(answer) => &answer.request_id,
        ServerMessage::CompactResult(answer) => &answer.request_id,
        ServerMessage::PlanUsageResult(answer) => &answer.request_id,
        ServerMessage::StatsSummaryResult(answer) => &answer.request_id,
        ServerMessage::WorkspaceInfoResult(answer) => &answer.request_id,
        ServerMessage::FsListResult(answer) => &answer.request_id,
        ServerMessage::FsReadResult(answer) => &answer.request_id,
        ServerMessage::FsImageResult(answer) => &answer.request_id,
        ServerMessage::FsSearchResult(answer) => &answer.request_id,
        ServerMessage::GitStatusResult(answer) => &answer.request_id,
        ServerMessage::GitDiffResult(answer) => &answer.request_id,
        ServerMessage::GitStageResult(answer) => &answer.request_id,
        ServerMessage::GitUnstageResult(answer) => &answer.request_id,
        ServerMessage::GitCommitResult(answer) => &answer.request_id,
        ServerMessage::GitBranchesResult(answer) => &answer.request_id,
        ServerMessage::GitCheckoutResult(answer) => &answer.request_id,
        ServerMessage::GitLogResult(answer) => &answer.request_id,
        ServerMessage::TermListResult(answer) => &answer.request_id,
        ServerMessage::TermOpenResult(answer) => &answer.request_id,
        ServerMessage::TermAttachResult(answer) => &answer.request_id,
        ServerMessage::TermDetachResult(answer) => &answer.request_id,
        ServerMessage::TermInputResult(answer) => &answer.request_id,
        ServerMessage::TermResizeResult(answer) => &answer.request_id,
        ServerMessage::TermCloseResult(answer) => &answer.request_id,
        ServerMessage::Error(error) => match &error.request_id {
            Some(id) => id,
            None => return Incoming::Unattributed(message),
        },
        ServerMessage::Event(_)
        | ServerMessage::Catalog(_)
        | ServerMessage::TermOutput(_)
        | ServerMessage::TermExited(_) => return Incoming::Pushed(message),
    };
    Incoming::Answer(id.clone(), message)
}

/// The bytes the link carries for `message`.
pub(crate) fn frame(message: &ClientMessage) -> Vec<u8> {
    encode_frame(message).into_bytes()
}

/// A contract frame from the bridge, or `None` for bytes that are not one: the bridge never sends
/// such a frame, and one it did could not be put with the request it answers.
pub(crate) fn read(bytes: &[u8]) -> Option<ServerMessage> {
    let text = std::str::from_utf8(bytes).ok()?;
    match decode_frame(text) {
        Ok(message) => Some(message),
        Err(error) => {
            tracing::debug!(%error, "a bridge frame that is not a contract frame");
            None
        }
    }
}
