package com.muzammil.broski

import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.printToString
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

    /** A wait that times out leaves the screen behind: a `waited-for-…` shot and the semantics tree in logcat. */
    fun waitFor(matcher: SemanticsMatcher, timeoutMs: Long = TIMEOUT_MS) {
        try {
            compose.waitUntilAtLeastOneExists(matcher, timeoutMs)
        } catch (timeout: ComposeTimeoutException) {
            Shots.save("waited-for-${System.currentTimeMillis()}")
            Log.e(TAG, "waited for ${matcher.description}; the screen:\n${compose.onRoot(useUnmergedTree = true).printToString()}")
            throw timeout
        }
    }

    /**
     * Waits until the first node [matcher] finds has stayed in one place for [STILL_MS]. A touch lands
     * where the node is when it is sent, and the keyboard's slide (which carries the composer with it)
     * is a window animation Compose's idleness does not wait for: a touch sent during it misses.
     */
    fun awaitStill(matcher: SemanticsMatcher) {
        var last = compose.onAllNodes(matcher).fetchSemanticsNodes().firstOrNull()?.boundsInRoot
        var since = SystemClock.uptimeMillis()
        compose.waitUntil(TIMEOUT_MS) {
            val now = compose.onAllNodes(matcher).fetchSemanticsNodes().firstOrNull()?.boundsInRoot
            if (now != last) {
                last = now
                since = SystemClock.uptimeMillis()
            }
            now != null && SystemClock.uptimeMillis() - since >= STILL_MS
        }
    }

    fun tap(matcher: SemanticsMatcher) {
        waitFor(matcher)
        compose.onAllNodes(matcher)[0].performClick()
    }

    fun tapText(text: String) = tap(hasText(text) and hasClickAction())

    fun tapIcon(description: String) = tap(hasContentDescription(description) and hasClickAction())

    /**
     * The served folder as a person reaches it: from the inbox's root, a session that runs there, then
     * Files in the chat's overflow. The session is seeded fresh, so it is the inbox's newest row.
     */
    fun openServedFolder() {
        tapIcon(string(R.string.nav_inbox))
        val title = "Files of ${UUID.randomUUID().toString().take(8)}"
        machine.seed(title)
        tap(hasContentDescription(title, substring = true) and hasClickAction())
        tapIcon(string(R.string.chat_more))
        tapText(string(R.string.chat_menu_files))
        waitFor(hasText("README.md"))
    }

    fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    companion object {
        const val TIMEOUT_MS = 20_000L
        private const val STILL_MS = 300L
        private const val TAG = "RealMachineTest"
    }
}
