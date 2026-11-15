package com.muzammil.broski

import android.util.Log
import com.muzammil.broski.feature.chat.LiveSession
import com.muzammil.broski.feature.chat.SessionClient
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import uniffi.broski_contract.ActionResult
import uniffi.broski_contract.ChoiceReply
import uniffi.broski_contract.InteractionAnswer
import uniffi.broski_contract.InteractionReply
import uniffi.broski_contract.InteractionRequest
import uniffi.broski_contract.PromptInput
import uniffi.broski_contract.PromptMode
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_contract.ToolPermissionReply
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.SessionView

/**
 * The chat's copy of a session ([LiveSession], what the chat renders) against the core's own: a
 * real view of a real session on test-machine's bridge, driven through each scenario, its copy
 * compared with `view.snapshot()` after every update; `stream` writes its text a part every 120 ms,
 * so an open block's text changes across batches, and keeps its file edit. A batch is the snapshot as it was when the
 * batch was taken, so a copy behind the view must be caught up by the very next update; once the
 * stream is quiet the two must be equal.
 */
class ReplicaFlow(private val machine: RealMachine) {
    private var updates = 0
    private var equalAtOnce = 0

    fun run() = runBlocking {
        follow("work") { _, _ -> }
        follow("stream") { replica, _ ->
            replica.until { live -> live.snapshot.blocks.any { it.text.isNotEmpty() } }
            replica.until { live -> live.snapshot.run?.items.orEmpty().any { it is TranscriptItem.ToolResult && it.v1.result.fileChanges.isNotEmpty() } }
        }
        follow("permission") { view, client -> answerFirst(view, client) { allowOnce(it) } }
        follow("ask") { view, client -> answerFirst(view, client) { InteractionReply.Choice(ChoiceReply("retry")) } }
        follow("hold") { _, _ -> }
        follow("replace") { _, _ -> }
        Log.i(TAG, "$updates updates, $equalAtOnce equal to the view's snapshot at once, the rest on the next")
        assertTrue("updates were compared", updates > 0)
    }

    /** One scenario: a session scripted with it, a prompt, and every update applied and compared until the run is over. */
    private suspend fun follow(scenario: String, act: suspend (Replica, SessionClient) -> Unit) {
        val session = machine.seed("Replica $scenario")
        machine.script(session, scenario)
        val view = requireNotNull(machine.phone.machine(machine.machineId)).attach(session)
        try {
            val replica = Replica(view)
            replica.next()
            val client = SessionClient(requireNotNull(machine.phone.machine(machine.machineId))) { replica.session }
            client.prompt(PromptInput(UUID.randomUUID().toString(), PromptMode.START, "Play $scenario", emptyList(), null))
            replica.until { it.snapshot.run != null || replica.runsEnded > 0 }
            if (scenario == "hold" || scenario == "replace") {
                replica.until { live -> live.snapshot.blocks.any { it.text.isNotEmpty() } || live.snapshot.run?.items?.isNotEmpty() == true }
                replica.quiet()
                machine.release(session)
            }
            act(replica, client)
            replica.until { it.snapshot.run == null && it.snapshot.interactions.isEmpty() }
            replica.quiet()
            if (scenario == "replace") assertNotEquals("the view followed the replacement", session, replica.session)
            // Seen, as a chat would leave them, so they stay out of the Done rows the script's cold start reads.
            listOf(session, replica.session).forEach { machine.phone.markSeen(machine.machineId, it) }
        } finally {
            view.detach()
            view.close()
        }
    }

    private suspend fun answerFirst(replica: Replica, client: SessionClient, reply: (InteractionRequest) -> InteractionReply) {
        replica.until { it.snapshot.interactions.isNotEmpty() }
        replica.quiet()
        val ask = replica.live.snapshot.interactions.first()
        assertEquals(ActionResult.Accepted::class, client.answer(InteractionAnswer(ask.id, reply(ask.request)))::class)
    }

    private fun allowOnce(request: InteractionRequest): InteractionReply {
        val options = (request as InteractionRequest.ToolPermission).v1.options
        return InteractionReply.ToolPermission(ToolPermissionReply(options.first { it.id == "allow_once" }.id, null, null, emptyList()))
    }

    private inner class Replica(private val view: SessionView) {
        var live = LiveSession()
        var runsEnded = 0
        val session: SessionRef get() = requireNotNull(live.session)

        /** Takes one update, applies it, and holds the copy to the view's snapshot. */
        suspend fun next(timeoutMs: Long = UPDATE_TIMEOUT_MS): Boolean {
            val update = withTimeoutOrNull(timeoutMs) { view.nextUpdate() } ?: return false
            check(update !is SessionUpdate.Ended) { "the view ended: $update" }
            val applied = live.apply(update)
            live = applied.session
            runsEnded += applied.endedRuns.size
            updates++
            if (live.snapshot == view.snapshot()) equalAtOnce++ else assertTrue("behind the view, and the next update catches up", next())
            return true
        }

        suspend fun until(condition: (LiveSession) -> Boolean) = withTimeout(SCENARIO_TIMEOUT_MS) {
            while (!condition(live)) check(next()) { "no update came while waiting" }
        }

        /** Drains the stream until it is quiet, then the copy is exactly the view's snapshot. */
        suspend fun quiet() {
            while (next(QUIET_MS)) Unit
            assertEquals(view.snapshot(), live.snapshot)
        }
    }

    private companion object {
        const val TAG = "ReplicaFlow"
        const val UPDATE_TIMEOUT_MS = 5_000L
        const val QUIET_MS = 700L
        const val SCENARIO_TIMEOUT_MS = 30_000L
    }
}
