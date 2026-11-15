package com.muzammil.broski

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput

/**
 * A terminal runs a session on the machine and it waits on a permission to run bash. No phone
 * prompted it and no chat is open, so the inbox row learns the ask by itself; the long-press menu
 * of the row approves it. The session stays in the inbox's cache, which the script's cold start reads.
 */
@OptIn(ExperimentalTestApi::class)
class InboxApproveFlow(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    fun run() {
        val session = machine.seed(TITLE)
        machine.runAsTerminalWithPermission(session)

        val compose = ui.compose
        val ask = hasContentDescription(ui.string(R.string.inbox_wants_to_run, ui.string(R.string.agent_pi), "rm -rf build"), substring = true)
        ui.waitFor(ask, TIMEOUT_MS)
        Shots.save("inbox-needs-you")
        compose.onNode(ask).performTouchInput { longClick() }
        val approve = ui.string(R.string.inbox_approve)
        ui.waitFor(hasText(approve))
        compose.onNodeWithText(ui.string(R.string.inbox_deny)).assertExists()
        Shots.save("inbox-row-actions")
        compose.onNodeWithText(approve).performClick()
        compose.waitUntilDoesNotExist(ask, TIMEOUT_MS)
        compose.onNodeWithText(ui.string(R.string.inbox_answered_elsewhere)).assertDoesNotExist()
        Shots.save("inbox-approved")
    }

    companion object {
        /** The row the script's cold start looks for in the cached inbox. */
        const val TITLE = "Clean the build folder"
        private const val TIMEOUT_MS = 30_000L
    }
}
