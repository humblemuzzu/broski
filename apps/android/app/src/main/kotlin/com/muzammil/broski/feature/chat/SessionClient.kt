package com.muzammil.broski.feature.chat

import uniffi.broski_contract.AbortRequest
import uniffi.broski_contract.ActionResult
import uniffi.broski_contract.AttachmentReadRequest
import uniffi.broski_contract.AttachmentReadResult
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.CompactRequest
import uniffi.broski_contract.InteractionAnswer
import uniffi.broski_contract.InteractionAnswerRequest
import uniffi.broski_contract.ModeSetRequest
import uniffi.broski_contract.ModelSetRequest
import uniffi.broski_contract.NewSessionResult
import uniffi.broski_contract.PageRequest
import uniffi.broski_contract.PromptInput
import uniffi.broski_contract.PromptRequest
import uniffi.broski_contract.PromptResult
import uniffi.broski_contract.QueueCancelRequest
import uniffi.broski_contract.ServerMessage
import uniffi.broski_contract.SessionDeleteRequest
import uniffi.broski_contract.SessionForkRequest
import uniffi.broski_contract.SessionGetRequest
import uniffi.broski_contract.SessionGetResult
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.SessionRenameRequest
import uniffi.broski_contract.ThinkingSetRequest
import uniffi.broski_contract.TranscriptReadRequest
import uniffi.broski_contract.TranscriptReadResult
import uniffi.broski_core.Machine

/**
 * The contract's requests about one session, answered with their own result unions. The core mints
 * request ids, so each goes out with an empty one; a failure to reach the bridge is a `ClientException`.
 * The session is read at each request: a view that followed a replacement goes on under a new id.
 */
class SessionClient(private val machine: Machine, private val current: () -> SessionRef) {
    private val session: SessionRef get() = current()

    suspend fun prompt(input: PromptInput): PromptResult =
        send<ServerMessage.PromptResult>(ClientMessage.Prompt(PromptRequest("", session, input))).v1.result

    suspend fun abort(): ActionResult =
        send<ServerMessage.AbortResult>(ClientMessage.Abort(AbortRequest("", session))).v1.result

    suspend fun answer(answer: InteractionAnswer): ActionResult = send<ServerMessage.InteractionAnswerResult>(
        ClientMessage.InteractionAnswer(InteractionAnswerRequest("", session, answer)),
    ).v1.result

    suspend fun cancelQueued(queueItemId: String): ActionResult = send<ServerMessage.QueueCancelResult>(
        ClientMessage.QueueCancel(QueueCancelRequest("", session, queueItemId)),
    ).v1.result

    suspend fun setModel(modelId: String): ActionResult =
        send<ServerMessage.ModelSetResult>(ClientMessage.ModelSet(ModelSetRequest("", session, modelId))).v1.result

    suspend fun setThinking(thinking: String): ActionResult =
        send<ServerMessage.ThinkingSetResult>(ClientMessage.ThinkingSet(ThinkingSetRequest("", session, thinking))).v1.result

    suspend fun setMode(axis: String, value: String): ActionResult =
        send<ServerMessage.ModeSetResult>(ClientMessage.ModeSet(ModeSetRequest("", session, axis, value))).v1.result

    suspend fun compact(): ActionResult =
        send<ServerMessage.CompactResult>(ClientMessage.Compact(CompactRequest("", session, null))).v1.result

    suspend fun transcript(cursor: String?, limit: Long): TranscriptReadResult = send<ServerMessage.TranscriptReadResult>(
        ClientMessage.TranscriptRead(TranscriptReadRequest("", session, PageRequest(cursor, limit))),
    ).v1.result

    suspend fun attachment(attachmentId: String): AttachmentReadResult = send<ServerMessage.AttachmentReadResult>(
        ClientMessage.AttachmentRead(AttachmentReadRequest("", session, attachmentId)),
    ).v1.result

    suspend fun summary(): SessionGetResult =
        send<ServerMessage.SessionGetResult>(ClientMessage.SessionGet(SessionGetRequest("", session))).v1.result

    suspend fun rename(title: String): ActionResult =
        send<ServerMessage.SessionRenameResult>(ClientMessage.SessionRename(SessionRenameRequest("", session, title))).v1.result

    suspend fun delete(): ActionResult =
        send<ServerMessage.SessionDeleteResult>(ClientMessage.SessionDelete(SessionDeleteRequest("", session))).v1.result

    suspend fun fork(): NewSessionResult =
        send<ServerMessage.SessionForkResult>(ClientMessage.SessionFork(SessionForkRequest("", session, null))).v1.result

    /** The core answers a request with its own result type or throws; any other answer is its `UnexpectedAnswer`. */
    private suspend inline fun <reified T : ServerMessage> send(message: ClientMessage): T = machine.request(message) as T

    companion object {
        /** A transcript page: enough for a screen and a half of a busy session, well under the bridge's 200. */
        const val PAGE_LIMIT = 100L

        /** The first read stands between a tap and the conversation on screen, so it carries one screen's worth. */
        const val FIRST_PAGE_LIMIT = 30L
    }
}
