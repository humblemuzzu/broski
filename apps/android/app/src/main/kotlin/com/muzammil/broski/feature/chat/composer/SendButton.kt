package com.muzammil.broski.feature.chat.composer

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.PromptMode

/** The faces of the composer's one button. */
enum class SendFace(val mode: PromptMode?) {
    Send(PromptMode.START),
    Queue(PromptMode.QUEUE),
    Steer(PromptMode.STEER),
    Stop(null),
}

/** The button's face, whether it can be pressed, and the other way to send a long press offers. */
@Immutable
data class SendButton(val face: SendFace, val enabled: Boolean, val alternative: SendFace? = null)

/**
 * The one rule for the button: idle, it sends; while a run is live it steers, as Enter does in the
 * agent's own terminal, or queues when the backend takes no steering, and a long press offers the
 * other when it takes both; live with nothing typed, it stops the run. A session that is only
 * watched sends nothing.
 */
fun sendButton(running: Boolean, hasInput: Boolean, modes: List<PromptMode>, controllable: Boolean): SendButton {
    if (!controllable) return SendButton(SendFace.Send, enabled = false)
    if (!running) return SendButton(SendFace.Send, enabled = hasInput)
    if (!hasInput) return SendButton(SendFace.Stop, enabled = true)
    val queue = PromptMode.QUEUE in modes
    val steer = PromptMode.STEER in modes
    return when {
        steer -> SendButton(SendFace.Steer, enabled = true, alternative = SendFace.Queue.takeIf { queue })
        queue -> SendButton(SendFace.Queue, enabled = true)
        else -> SendButton(SendFace.Send, enabled = false)
    }
}
