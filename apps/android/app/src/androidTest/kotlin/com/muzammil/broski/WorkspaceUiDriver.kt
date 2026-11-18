package com.muzammil.broski

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.rules.ActivityScenarioRule
import com.muzammil.broski.app.MainActivity
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.feature.workspace.lastComponent
import java.util.UUID

/** Finds and taps through a session's files as a person would, waiting for what the Mac sends back. */
@OptIn(ExperimentalTestApi::class)
class WorkspaceUiDriver(
    val compose: AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>,
    private val machine: RealMachine,
) {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    val rootName: String get() = lastComponent(machine.root)

    fun string(id: Int, vararg args: Any): String = context.getString(id, *args)

    fun waitFor(matcher: SemanticsMatcher, timeoutMs: Long = TIMEOUT_MS) = compose.waitUntilAtLeastOneExists(matcher, timeoutMs)

    fun tap(matcher: SemanticsMatcher) {
        waitFor(matcher)
        compose.onAllNodes(matcher)[0].performClick()
    }

    fun tapText(text: String) = tap(hasText(text) and hasClickAction())

    fun tapIcon(description: String) = tap(hasContentDescription(description) and hasClickAction())

    /**
     * The served folder as a person reaches it: from the inbox's root, a session that runs there, then
     * the chat's Files button. The session is seeded fresh, so it is the inbox's newest row.
     */
    fun openServedFolder() {
        tapText(string(R.string.nav_inbox))
        val title = "Files of ${UUID.randomUUID().toString().take(8)}"
        machine.seed(title)
        tap(hasContentDescription(title, substring = true) and hasClickAction())
        tapIcon(string(R.string.chat_open_files))
        waitFor(hasText("README.md"))
    }

    fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
