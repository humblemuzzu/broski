package com.muzammil.broski.feature.chat.composer

import org.junit.Assert.assertEquals
import org.junit.Test
import uniffi.broski_contract.PromptMode

/** The composer's one button, by design.md's rule, for each backend's prompt modes. */
class SendButtonTest {
    private val all = listOf(PromptMode.START, PromptMode.STEER, PromptMode.QUEUE)

    @Test
    fun idleItSendsWhenThereIsSomethingToSend() {
        assertEquals(SendButton(SendFace.Send, enabled = true), sendButton(running = false, hasInput = true, all, controllable = true))
        assertEquals(SendButton(SendFace.Send, enabled = false), sendButton(running = false, hasInput = false, all, controllable = true))
    }

    @Test
    fun runningAndEmptyItStops() {
        assertEquals(SendButton(SendFace.Stop, enabled = true), sendButton(running = true, hasInput = false, all, controllable = true))
    }

    @Test
    fun runningWithTextItQueuesAndALongPressOffersSteerWhenTheBackendTakesBoth() {
        assertEquals(SendButton(SendFace.Queue, true, SendFace.Steer), sendButton(running = true, hasInput = true, all, controllable = true))
        assertEquals(
            SendButton(SendFace.Queue, true, null),
            sendButton(running = true, hasInput = true, listOf(PromptMode.START, PromptMode.QUEUE), controllable = true),
        )
        assertEquals(
            SendButton(SendFace.Steer, true, null),
            sendButton(running = true, hasInput = true, listOf(PromptMode.START, PromptMode.STEER), controllable = true),
        )
    }

    @Test
    fun aBackendThatOnlyStartsCannotTakeAMessageWhileItRuns() {
        assertEquals(SendButton(SendFace.Send, enabled = false), sendButton(running = true, hasInput = true, listOf(PromptMode.START), controllable = true))
    }

    @Test
    fun aWatchedSessionSendsNothing() {
        assertEquals(SendButton(SendFace.Send, enabled = false), sendButton(running = true, hasInput = false, all, controllable = false))
        assertEquals(SendButton(SendFace.Send, enabled = false), sendButton(running = false, hasInput = true, all, controllable = false))
    }

    @Test
    fun eachFaceSendsItsMode() {
        assertEquals(listOf(PromptMode.START, PromptMode.QUEUE, PromptMode.STEER, null), SendFace.entries.map { it.mode })
    }
}
