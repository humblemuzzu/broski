package com.muzammil.broski.feature.chat

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.muzammil.broski.Shots
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.feature.chat.work.DiffSheet
import org.junit.Rule
import org.junit.Test
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.FileChangeKind

/**
 * A file change's diff as the chat opens it from a work row or a permission card, parsed by the real
 * core. The machine's fake backend withdraws every edit its scenarios make, so this is where the
 * sheet is seen with a real change.
 */
@OptIn(ExperimentalTestApi::class)
class DiffSheetTest {
    @get:Rule
    val compose = createComposeRule()

    private val change = FileChange(
        path = "src/count.ts",
        change = FileChangeKind.MODIFIED,
        previousPath = null,
        diff = "@@ -1,3 +1,3 @@\n import { log } from \"./log\";\n-let count = 1;\n+let count = 2;\n log(count);\n",
        additions = 1,
        deletions = 1,
    )

    @Test
    fun aChangeOpensAsAUnifiedDiffWithBothLineNumbersAndItsCounts() {
        compose.setContent { BroskiTheme(Appearance.Dark) { DiffSheet(change) {} } }
        compose.waitUntilAtLeastOneExists(hasText("+let count = 2;"), TIMEOUT_MS)
        compose.onNode(hasText("-let count = 1;")).assertExists()
        compose.onNode(hasText("src/count.ts")).assertExists()
        compose.onNode(hasText("+1")).assertExists()
        compose.waitForIdle()
        Shots.save("chat-diff-dark")
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
