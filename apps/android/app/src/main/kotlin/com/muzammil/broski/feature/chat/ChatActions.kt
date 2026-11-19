package com.muzammil.broski.feature.chat

import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import com.muzammil.broski.feature.chat.composer.Outgoing
import com.muzammil.broski.feature.chat.transcript.PendingSend
import com.muzammil.broski.feature.images.ImageTarget
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.ActionResult
import uniffi.broski_contract.InteractionAnswer
import uniffi.broski_contract.InteractionReply
import uniffi.broski_contract.NewSessionResult
import uniffi.broski_contract.PromptDisposition
import uniffi.broski_contract.PromptMode
import uniffi.broski_contract.PromptResult
import uniffi.broski_contract.RejectionCode
import uniffi.broski_core.ClientException

/** How an answer the person gave ended: on its way, taken, or too late. */
enum class AnswerState { Sending, Stale }

/**
 * What the person does in a chat, each one request: send, stop, answer, the composer's settings and
 * the session's own actions. Each sends exactly what was tapped; a refusal or a failure is said
 * through the view model's events and nothing is retried on the person's behalf.
 */
class ChatActions(
    private val model: ChatViewModel,
    private val images: ImageAttachments,
    private val events: MutableSharedFlow<ChatEvent>,
) {
    private val scope get() = model.viewModelScope
    private val client get() = model.feed.client
    private val mutableAnswers = MutableStateFlow<Map<String, AnswerState>>(emptyMap())

    /** Interactions whose answer is on its way, or was too late; a card's buttons wait on it. */
    val answers: StateFlow<Map<String, AnswerState>> = mutableAnswers.asStateFlow()

    fun send(mode: PromptMode) = deliver(model.composer.take(mode))

    /** Sends a prompt, shown at once and dimmed until the agent shows it as its own. */
    fun deliver(outgoing: Outgoing) {
        val id = outgoing.input.clientRequestId
        model.images.rememberOutgoing(id, outgoing.images)
        val localTargets = outgoing.images.map { ImageTarget.Local(it.id, name = null) }
        model.feed.sent(PendingSend(id, outgoing.input.text, System.currentTimeMillis(), localTargets))
        scope.launch {
            val result = try {
                client.prompt(outgoing.input)
            } catch (error: ClientException) {
                model.feed.withdrawn(id)
                model.composer.restore(outgoing)
                events.emit(ChatEvent.Failed(error))
                return@launch
            }
            when (result) {
                is PromptResult.Accepted -> if (result.v1.disposition == PromptDisposition.HANDLED) model.feed.withdrawn(id)
                is PromptResult.Rejected -> {
                    model.feed.withdrawn(id)
                    model.composer.restore(outgoing)
                    events.emit(ChatEvent.Refused(result.v1.rejection.code, result.v1.rejection.message))
                }
            }
        }
    }

    fun stop() = act { client.abort() }

    fun answer(interactionId: String, reply: InteractionReply) {
        if (mutableAnswers.getAndUpdate { it + (interactionId to AnswerState.Sending) }[interactionId] == AnswerState.Sending) return
        scope.launch {
            val result = try {
                client.answer(InteractionAnswer(interactionId, reply))
            } catch (error: ClientException) {
                events.emit(ChatEvent.Failed(error))
                null
            }
            val stale = (result as? ActionResult.Rejected)?.v1?.rejection?.code == RejectionCode.STALE
            mutableAnswers.update { if (stale) it + (interactionId to AnswerState.Stale) else it - interactionId }
            when {
                stale -> events.emit(ChatEvent.AnsweredElsewhere)
                result is ActionResult.Rejected -> events.emit(ChatEvent.Refused(result.v1.rejection.code, result.v1.rejection.message))
            }
        }
    }

    fun cancelQueued(queueItemId: String) = act { client.cancelQueued(queueItemId) }

    fun setModel(modelId: String) = act { client.setModel(modelId) }

    fun setThinking(thinking: String) = act { client.setThinking(thinking) }

    fun setMode(axis: String, value: String) = act { client.setMode(axis, value) }

    fun compact() = act { client.compact() }

    fun rename(title: String) = act({ model.readSummary() }) { client.rename(title.trim()) }

    fun delete() = act({ events.emit(ChatEvent.Deleted) }) { client.delete() }

    fun fork() {
        scope.launch {
            when (val result = request { client.fork() }) {
                is NewSessionResult.Accepted -> events.emit(ChatEvent.OpenSession(result.v1.session))
                is NewSessionResult.Rejected -> events.emit(ChatEvent.Refused(result.v1.rejection.code, result.v1.rejection.message))
                null -> Unit
            }
        }
    }

    fun attachImage(uri: Uri) {
        scope.launch {
            val image = images.read(uri, model.composer.imageBudget)
            if (image == null) events.emit(ChatEvent.ImageTooLarge) else model.composer.add(image)
        }
    }

    private fun act(onAccepted: suspend () -> Unit = {}, request: suspend () -> ActionResult) {
        scope.launch {
            when (val result = request(request)) {
                is ActionResult.Accepted -> onAccepted()
                is ActionResult.Rejected -> events.emit(ChatEvent.Refused(result.v1.rejection.code, result.v1.rejection.message))
                null -> Unit
            }
        }
    }

    /** The answer, or `null` once the failure to get one is said. */
    private suspend fun <T> request(send: suspend () -> T): T? = try {
        send()
    } catch (error: ClientException) {
        events.emit(ChatEvent.Failed(error))
        null
    }
}
