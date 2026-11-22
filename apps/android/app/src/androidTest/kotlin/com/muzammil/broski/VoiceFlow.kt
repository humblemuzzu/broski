package com.muzammil.broski

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.click
import androidx.compose.ui.test.down
import androidx.compose.ui.test.up
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.test.platform.app.InstrumentationRegistry

/**
 * Dictation on the real machine: Settings › Voice keeps the person's words and, when the run hands one
 * in (`-e xaiKey`), a key xAI checked. Then the mic of a chat records until ✓, and the recording makes
 * the round trip to xAI: the emulator's microphone hears silence, so it comes back as "Didn't catch any
 * words." Without a key the mic hands over to the phone's own recognizer, which the test cannot drive.
 */
@OptIn(ExperimentalTestApi::class)
class VoiceFlow(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    private val compose get() = ui.compose
    private val key: String? = InstrumentationRegistry.getArguments().getString("xaiKey")?.takeIf { it.isNotBlank() }

    fun run() {
        ui.tapIcon(ui.string(R.string.nav_settings))
        touch(hasText(ui.string(R.string.voice_title)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.voice_title)))
        addAWord()
        key?.let(::saveTheKey)
        Shots.save("voice-settings")
        ui.back()
        ui.tapIcon(ui.string(R.string.nav_inbox))
        if (key != null) dictateIntoAChat()
    }

    private fun addAWord() {
        val field = hasSetTextAction() and hasText(ui.string(R.string.voice_words_add), substring = true)
        compose.onAllNodes(hasScrollToNodeAction())[0].performScrollToNode(field)
        compose.onAllNodes(field)[0].performTextInput("Zanzibar")
        touch(hasText(ui.string(R.string.voice_words_add_action)) and hasClickAction())
        ui.waitFor(hasText("Zanzibar"))
    }

    private fun saveTheKey(key: String) {
        val field = hasSetTextAction() and hasText(ui.string(R.string.voice_key_field), substring = true)
        compose.onAllNodes(hasScrollToNodeAction())[0].performScrollToNode(field)
        compose.onAllNodes(field)[0].performTextInput(key)
        touch(hasText(ui.string(R.string.voice_key_save)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.voice_key_checked)), RECORDING_MS * 2)
    }

    private fun dictateIntoAChat() {
        val title = "Dictate a prompt"
        machine.seed(title)
        touch(hasContentDescription(title, substring = true) and hasClickAction())
        ui.waitFor(hasSetTextAction())
        touch(hasContentDescription(ui.string(R.string.dictation_dictate)) and hasClickAction())
        ui.waitFor(hasContentDescription(ui.string(R.string.dictation_insert)))
        Thread.sleep(RECORDING_MS)
        Shots.save("voice-recording")
        touch(hasContentDescription(ui.string(R.string.dictation_insert)) and hasClickAction())
        ui.waitFor(hasText(ui.string(R.string.dictation_heard_nothing)), RECORDING_MS * 6)
        Shots.save("voice-came-back")
        compose.waitUntilDoesNotExist(hasText(ui.string(R.string.dictation_heard_nothing)), RECORDING_MS * 3)

        // Held, the mic records until the finger lifts, then the recording goes as a tap's does.
        val mic = compose.onAllNodes(hasContentDescription(ui.string(R.string.dictation_dictate)) and hasClickAction())[0]
        mic.performTouchInput { down(center) }
        ui.waitFor(hasContentDescription(ui.string(R.string.dictation_recording)))
        Thread.sleep(RECORDING_MS)
        Shots.save("voice-held")
        compose.onAllNodes(hasContentDescription(ui.string(R.string.dictation_recording)))[0].performTouchInput { up() }
        ui.waitFor(hasText(ui.string(R.string.dictation_heard_nothing)), RECORDING_MS * 6)
        ui.back()
    }

    private fun touch(matcher: SemanticsMatcher) {
        ui.waitFor(matcher)
        ui.awaitStill(matcher)
        compose.onAllNodes(matcher)[0].performTouchInput { click() }
    }

    private companion object {
        const val RECORDING_MS = 3_000L
    }
}
