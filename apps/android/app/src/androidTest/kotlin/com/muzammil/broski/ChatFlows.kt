package com.muzammil.broski

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.click
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.core.settings.Appearance
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
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
    private val pi get() = machine.agentName

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

    /** While a run is live the button steers; the queue is what a long press offers. */
    private fun queue(text: String) {
        compose.onAllNodes(hasSetTextAction())[0].performTextInput(text)
        val steer = hasContentDescription(ui.string(R.string.composer_steer)) and hasClickAction()
        ui.waitFor(steer)
        ui.awaitStill(steer)
        compose.onAllNodes(steer)[0].performTouchInput { longClick() }
        touchText(ui.string(R.string.composer_queue))
    }

    private fun touch(matcher: SemanticsMatcher) {
        ui.waitFor(matcher)
        ui.awaitStill(matcher)
        compose.onAllNodes(matcher)[0].performTouchInput { click() }
    }

    private fun touchText(text: String) = touch(hasText(text) and hasClickAction())

    /** Touched, the composer opens with its model pill, which ends left of the mic, not under it. */
    private fun checkTheModelPillIsClearOfTheMic(suffix: String) {
        touch(hasSetTextAction())
        val pill = model()
        ui.waitFor(pill)
        shot("composer-open-$suffix")
        val bounds = compose.onAllNodes(pill)[0].fetchSemanticsNode().boundsInWindow
        val mic = compose.onNode(hasContentDescription(ui.string(R.string.dictation_dictate))).fetchSemanticsNode().boundsInWindow
        assertTrue("the model pill ends at ${bounds.right}, under the mic that starts at ${mic.left}", bounds.right <= mic.left)
    }

    private fun model() = hasContentDescription(ui.string(R.string.composer_model_pill, ""), substring = true) and hasClickAction()

    /** The run is over: the button no longer stops it. */
    private fun waitForTheRunToEnd() {
        val stop = hasContentDescription(ui.string(R.string.composer_stop))
        compose.waitUntil(TIMEOUT_MS) { compose.onAllNodes(stop).fetchSemanticsNodes().isEmpty() }
    }

    /**
     * An opened row says what it did, and its detail holds the command after its dimmed `$ `: the
     * command is on screen once.
     */
    private fun checkTheCommandIsShownOnce() {
        ui.waitFor(hasText("Ran command"))
        compose.onAllNodes(hasText("rm -rf build", substring = true)).assertCountEquals(1)
    }

    /** A tap's ripple on Android 12+ is a speckled sparkle that Compose's idleness does not wait for: a shot taken at once shows it as grain over the tapped rows. */
    private fun shot(name: String) {
        compose.waitForIdle()
        Thread.sleep(RIPPLE_SETTLE_MS)
        Shots.save(name)
    }

    private fun openFold() = touch(hasContentDescription(ui.string(R.string.chat_work_worked), substring = true) and hasClickAction())

    fun openSendAndWatchWork() {
        open("Tidy the notes", "work")
        shot("chat-open-light")
        touch(hasSetTextAction())
        ui.waitFor(model())
        shot("composer-open-light")
        touch(model())
        ui.waitFor(hasText(ui.string(R.string.composer_thinking)))
        shot("model-sheet-light")
        touch(hasText(ui.string(R.string.composer_thinking)) and hasClickAction())
        ui.waitFor(hasText("High") and hasClickAction())
        shot("model-sheet-thinking-light")
        touch(hasText("High") and hasClickAction())
        touch(hasContentDescription(ui.string(R.string.composer_close)) and hasClickAction())
        ui.waitFor(hasContentDescription("High", substring = true) and hasContentDescription(ui.string(R.string.composer_model_pill, ""), substring = true))
        send("Tidy the notes, please")
        ui.waitFor(hasText("Paragraph 24", substring = true))
        waitForTheRunToEnd()
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
        // Not "Clean the build…": the inbox step's session is "Clean the build folder".
        open("Empty the dist folder", "permission")
        send("Empty the dist folder")
        touchText("Allow")
        ui.waitFor(hasText("Cleaned."))
        openFold()
        touchText("rm -rf build")
        ui.waitFor(hasText("removed"))
        checkTheCommandIsShownOnce()
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
        queue("Then check the tests")
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

    /** Files in the header's overflow opens the Workspace's browser in the session's folder; `/` lists the agent's commands and picks one. */
    fun filesAndCommands() {
        open("Where am I")
        touch(hasContentDescription(ui.string(R.string.chat_more)) and hasClickAction())
        touchText(ui.string(R.string.chat_menu_files))
        ui.waitFor(hasText("README.md"))
        ui.waitFor(hasText("src"))
        shot("chat-files-light")
        ui.back()
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("/rev")
        ui.waitFor(hasText("/review [path]"))
        shot("chat-commands-light")
        touchText("/review [path]")
        ui.waitFor(hasText("/review"))
        send("src")
        ui.waitFor(hasText("Done."))
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
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("A draft to come back to")
        ui.back()
        // Seen now, the row went to Idle, at the inbox's end.
        val row = hasContentDescription("Renamed from the phone", substring = true) and hasClickAction()
        compose.onAllNodes(hasScrollToNodeAction())[0].performScrollToNode(row)
        touch(row)
        ui.waitFor(hasSetTextAction() and hasText("A draft to come back to"))
        ui.back()
    }

    /**
     * New session opens on the folders the Mac's sessions ran in; All projects browses the Mac from home,
     * where Select picks `src/`, and Send turns the screen into that session's chat.
     */
    fun newSessionInAFolderBrowsedTo() {
        touch(hasContentDescription(ui.string(R.string.new_session)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.new_session_question)))
        ui.waitFor(hasText(ui.rootName) and hasClickAction())
        shot("new-session-light")
        touchText(ui.string(R.string.new_session_all_projects))
        ui.waitFor(hasText(ui.string(R.string.new_session_projects)))
        shot("new-session-projects-light")
        touchText(ui.string(R.string.new_session_choose_folder))
        touchText("src")
        ui.waitFor(hasText("~/src"))
        shot("new-session-browse-light")
        touchText(ui.string(R.string.new_session_select))
        ui.waitFor(hasText("src") and hasClickAction())
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("Write the release notes")
        shot("new-session-typed-light")
        touch(hasContentDescription(ui.string(R.string.composer_send)) and hasClickAction())
        ui.waitFor(hasText("Write the release notes"))
        ui.waitFor(hasText("Done."))
        ui.waitFor(hasText("src", substring = true))
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

    /** The chat's states again in dark. */
    fun inDark() {
        val core = (machine.context.applicationContext as BroskiApplication).core
        try {
            runBlocking { core.settingsStore.setAppearance(Appearance.Dark) }
            visitStates("dark")
        } finally {
            runBlocking { core.settingsStore.setAppearance(Appearance.System) }
        }
    }

    /**
     * The chat's states at twice the font size. The scale is set first thing, while the activity is
     * idle, so the scenario's recreate wins the race with the system's own relaunch, which the test
     * rule would not follow.
     */
    fun atTwiceTheFontSize() {
        try {
            Shots.shell("settings put system font_scale 2.0")
            compose.activityRule.scenario.recreate()
            visitStates("font2")
        } finally {
            Shots.shell("settings put system font_scale 1.0")
        }
    }

    private fun visitStates(suffix: String) {
        val session = open("Looks $suffix", "permission")
        checkTheModelPillIsClearOfTheMic(suffix)
        send("Clean the build in $suffix")
        ui.waitFor(hasText(ui.string(R.string.card_wants_to_run, pi)))
        shot("chat-permission-$suffix")
        touchText("Allow")
        ui.waitFor(hasText("Cleaned."))
        openFold()
        touchText("rm -rf build")
        ui.waitFor(hasText("removed"))
        checkTheCommandIsShownOnce()
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
        ui.waitFor(hasText(ui.string(R.string.new_session_question)))
        shot("new-session-$suffix")
        ui.back()
    }

    private companion object {
        const val TIMEOUT_MS = 20_000L
        const val RIPPLE_SETTLE_MS = 600L
    }
}
