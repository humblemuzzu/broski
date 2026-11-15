package com.muzammil.broski

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.test.core.app.ActivityScenario
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.app.MainActivity
import com.muzammil.broski.core.settings.Appearance
import kotlinx.coroutines.runBlocking
import uniffi.broski_contract.SessionRef

/**
 * The chat on the real machine, as a person uses it: open a session from the inbox, send from the
 * composer, read the work, answer what the agent asks, queue while it runs, stop it, rename it,
 * start one from the New session sheet, and come back to the end after reading further up. Taps are
 * touches, as a finger's, so what the screenshots show is what a person sees.
 */
@OptIn(ExperimentalTestApi::class)
class ChatFlows(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    private val compose get() = ui.compose
    private val pi get() = ui.string(R.string.agent_pi)

    /** A session scripted with [scenario], opened from its inbox row. */
    private fun open(title: String, scenario: String? = null): SessionRef {
        val session = machine.seed(title)
        scenario?.let { machine.script(session, it) }
        touch(hasContentDescription(title, substring = true) and hasClickAction())
        ui.waitFor(hasSetTextAction())
        return session
    }

    private fun send(text: String, face: Int = R.string.composer_send) {
        compose.onAllNodes(hasSetTextAction())[0].performTextInput(text)
        touch(hasContentDescription(ui.string(face)) and hasClickAction())
    }

    private fun touch(matcher: SemanticsMatcher) {
        ui.waitFor(matcher)
        compose.onAllNodes(matcher)[0].performTouchInput { click() }
    }

    private fun touchText(text: String) = touch(hasText(text) and hasClickAction())

    private fun shot(name: String) {
        compose.waitForIdle()
        Shots.save(name)
    }

    private fun openFold() = touch(hasContentDescription(ui.string(R.string.chat_work_worked), substring = true) and hasClickAction())

    fun openSendAndWatchWork() {
        open("Tidy the notes", "work")
        shot("chat-open-light")
        send("Tidy the notes, please")
        ui.waitFor(hasText("Paragraph 24", substring = true))
        ui.waitFor(hasContentDescription(ui.string(R.string.composer_send)))
        shot("chat-work-light")
        ui.back()
    }

    /** Deny with words on a permission: the call is denied, the run goes on, and the fold says so. */
    fun denyWithInstructions() {
        open("Clean the cache", "permission")
        send("Clean the cache")
        ui.waitFor(hasText(ui.string(R.string.card_wants_to_run, pi)))
        shot("chat-permission-light")
        // The card's field comes before the composer's.
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("Only remove the cache folder")
        shot("chat-permission-deny-typed-light")
        touchText("Deny")
        ui.waitFor(hasText("Cleaned."))
        openFold()
        ui.waitFor(hasText(ui.string(R.string.chat_work_outcome_denied)))
        shot("chat-fold-denied-light")
        ui.back()
    }

    /** Allow once: the command runs, and its row in the fold opens to what it ran and printed. */
    fun allowAndReadTheWork() {
        open("Clean the build", "permission")
        send("Clean the build")
        touchText("Allow")
        ui.waitFor(hasText("Cleaned."))
        openFold()
        touchText("rm -rf build")
        ui.waitFor(hasText("removed"))
        shot("chat-fold-detail-light")
        ui.back()
    }

    fun answerAnAsk() {
        open("Pick a retry", "ask")
        send("Try again")
        ui.waitFor(hasText("Pick one"))
        shot("chat-ask-light")
        touchText("Retry")
        ui.waitFor(hasText("Thanks."))
        ui.back()
    }

    /** While a run holds, a message queues and runs after it; Stop ends the next held run. */
    fun queueWhileRunningThenStop() {
        val session = open("Hold the line", "hold")
        send("Start and wait")
        ui.waitFor(hasContentDescription(ui.string(R.string.composer_stop)))
        shot("chat-running-light")
        send("Then check the tests", R.string.composer_queue)
        ui.waitFor(hasContentDescription(ui.string(R.string.chat_queued)))
        shot("chat-queued-light")
        machine.release(session)
        ui.waitFor(hasText("Then check the tests"))

        machine.script(session, "hold")
        send("Hold again")
        ui.waitFor(hasText("Working."))
        touch(hasContentDescription(ui.string(R.string.composer_stop)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.chat_note_stopped)))
        shot("chat-stopped-light")
        ui.back()
    }

    fun renameFromTheHeader() {
        open("Name me")
        touch(hasContentDescription(ui.string(R.string.chat_more)) and hasClickAction())
        touchText(ui.string(R.string.chat_rename))
        compose.onAllNodes(hasSetTextAction() and hasAnyAncestor(isDialog()))[0].performTextReplacement("Renamed from the phone")
        shot("chat-rename-light")
        touchText(ui.string(R.string.chat_rename_confirm))
        ui.waitFor(hasText("Renamed from the phone"))
        ui.back()
    }

    fun newSessionFromTheSheet() {
        touch(hasContentDescription(ui.string(R.string.new_session)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.new_session_question_start), substring = true))
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("Write the release notes")
        shot("new-session-light")
        touch(hasContentDescription(ui.string(R.string.composer_send)) and hasClickAction())
        ui.waitFor(hasText("Write the release notes"))
        ui.waitFor(hasText("Done."))
        shot("new-session-chat-light")
        ui.back()
    }

    /** Reading further up detaches the transcript; the jump button says so and brings it back to the end. */
    fun jumpToLatest() {
        open("A long answer", "work")
        send("Tell me everything")
        ui.waitFor(hasText("Paragraph 24", substring = true))
        repeat(3) { compose.onAllNodes(hasText("Paragraph", substring = true))[0].performTouchInput { swipeDown() } }
        val jump = hasContentDescription(ui.string(R.string.chat_jump_to_latest))
        ui.waitFor(jump)
        shot("chat-detached-light")
        touch(jump and hasClickAction())
        compose.waitUntil(TIMEOUT_MS) { compose.onAllNodes(jump).fetchSemanticsNodes().isEmpty() }
        ui.waitFor(hasText("Paragraph 24", substring = true))
        ui.back()
    }

    /** The chat's states again in dark, then at twice the font size. */
    fun appearances() {
        val core = (machine.context.applicationContext as BroskiApplication).core
        try {
            runBlocking { core.settingsStore.setAppearance(Appearance.Dark) }
            visitStates("dark")
            runBlocking { core.settingsStore.setAppearance(Appearance.Light) }
            // The new scale recreates the activity behind the rule's back; a launch after it gives
            // the test an activity it follows again.
            Shots.shell("settings put system font_scale 2.0")
            Thread.sleep(SETTLE_MS)
            ActivityScenario.launch(MainActivity::class.java).use { visitStates("font2") }
        } finally {
            Shots.shell("settings put system font_scale 1.0")
            runBlocking { core.settingsStore.setAppearance(Appearance.System) }
        }
    }

    private fun visitStates(suffix: String) {
        val session = open("Looks $suffix", "permission")
        send("Clean the build in $suffix")
        ui.waitFor(hasText(ui.string(R.string.card_wants_to_run, pi)))
        shot("chat-permission-$suffix")
        touchText("Allow")
        ui.waitFor(hasText("Cleaned."))
        openFold()
        touchText("rm -rf build")
        ui.waitFor(hasText("removed"))
        shot("chat-fold-detail-$suffix")
        machine.script(session, "ask")
        send("Ask me")
        ui.waitFor(hasText("Pick one"))
        shot("chat-ask-$suffix")
        touchText("Retry")
        ui.waitFor(hasText("Thanks."))
        machine.script(session, "hold")
        send("Hold on")
        ui.waitFor(hasContentDescription(ui.string(R.string.composer_stop)))
        shot("chat-running-$suffix")
        machine.release(session)
        ui.back()
        touch(hasContentDescription(ui.string(R.string.new_session)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.new_session_question_start), substring = true))
        shot("new-session-$suffix")
        ui.back()
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val SETTLE_MS = 2_000L
    }
}
