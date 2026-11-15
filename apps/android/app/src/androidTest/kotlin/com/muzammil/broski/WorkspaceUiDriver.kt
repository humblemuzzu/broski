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

/** Finds and taps through the Workspace as a person would, waiting for what the Mac sends back. */
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

    /** The Workspace tab of the navigation bar, then one of Files, Git and Terminal. */
    fun openWorkspace(tab: Int) {
        tapText(string(R.string.nav_workspace))
        tapText(string(tab))
    }

    fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    companion object {
        const val TIMEOUT_MS = 20_000L
    }
}
