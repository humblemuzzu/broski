package com.muzammil.broski

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

/** A session's files on the real machine's served repository, from the chat's Files button, driven through the UI. */
@OptIn(ExperimentalTestApi::class)
class WorkspaceFlows(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    private val client get() = WorkspaceClient(requireNotNull(machine.phone.machine(machine.machineId))::request)

    /** The served repository's branch, which its row on the folder screen is named by. */
    private val branch: String get() = requireNotNull((runBlocking { client.status(machine.root) } as Answer.Done).value.branch)

    fun files() {
        ui.openServedFolder()
        ui.waitFor(hasText("src"))
        Shots.save("files-light")

        ui.tapText("README.md")
        ui.waitFor(hasText("A repository for the app tests, edited."))
        Shots.save("file-light")
        ui.back()

        ui.waitFor(hasSetTextAction())
        compose().onAllNodes(hasSetTextAction())[0].performTextInput("main.rs")
        ui.waitFor(hasText("src/main.rs"))
        Shots.save("files-search-light")
    }

    /** Files, a file, Git, a diff and a terminal, in dark and then at font scale 2.0. */
    fun appearances() {
        val core = (machine.context.applicationContext as BroskiApplication).core
        try {
            runBlocking { core.settingsStore.setAppearance(Appearance.Dark) }
            visitScreens("dark")
            runBlocking { core.settingsStore.setAppearance(Appearance.Light) }
            Shots.shell("settings put system font_scale 2.0")
            ui.compose.activityRule.scenario.recreate()
            visitScreens("font2")
        } finally {
            Shots.shell("settings put system font_scale 1.0")
            runBlocking { core.settingsStore.setAppearance(Appearance.System) }
        }
    }

    private fun visitScreens(suffix: String) {
        ui.openServedFolder()
        Shots.save("files-$suffix")
        ui.tapText("README.md")
        ui.waitFor(hasText("A repository for the app tests, edited."))
        Shots.save("file-$suffix")
        ui.back()
        ui.tapText(branch)
        ui.waitFor(hasText("untracked.txt"))
        Shots.save("git-$suffix")
        ui.tapText("README.md")
        ui.waitFor(hasText("+Another line."))
        Shots.save("diff-$suffix")
        ui.back()
        ui.back()
        openTerminalHere()
        Shots.save("terminal-$suffix")
        ui.back()
    }

    fun git() {
        ui.openServedFolder()
        ui.tapText(branch)
        ui.waitFor(hasText("untracked.txt"))
        Shots.save("git-light")
        ui.tapText("README.md")
        ui.waitFor(hasText("+Another line."))
        ui.waitFor(hasText("\u2212A repository for the app tests."))
        Shots.save("diff-light")
        ui.back()

        compose().onAllNodes(hasText("README.md"))[0].performTouchInput { swipeLeft() }
        ui.waitFor(hasText(ui.string(R.string.git_area_staged)))
        compose().onAllNodes(hasSetTextAction())[0].performTextInput("Edit the readme from the phone")
        ui.tapText(ui.string(R.string.git_commit))
        ui.waitFor(hasText("Edit the readme from the phone") and !hasSetTextAction())
        Shots.save("git-committed-light")

        val status = (runBlocking { client.status(machine.root) } as Answer.Done).value
        assertTrue("nothing is left staged or changed", status.staged.isEmpty() && status.unstaged.isEmpty())
        val log = (runBlocking { client.log(machine.root, 1) } as Answer.Done).value
        assertEquals("Edit the readme from the phone", log.commits.single().subject)
    }

    /** A terminal opened in the folder runs what is typed, and the folder lists it to come back to. */
    fun terminal() {
        ui.openServedFolder()
        openTerminalHere()
        InstrumentationRegistry.getInstrumentation().sendStringSync("echo broski \$((6*7))\n")
        ui.waitFor(hasContentDescription(ui.string(R.string.terminal_title)) and hasText("broski 42", substring = true))
        Shots.save("terminal-light")
        ui.back()
        ui.waitFor(hasText(ui.string(R.string.workspace_terminals)))
        ui.waitFor(hasText(ui.string(R.string.terminal_running), substring = true))
        Shots.save("folder-terminals-light")
        ui.tap(hasText(ui.string(R.string.terminal_running), substring = true) and hasClickAction())
        ui.waitFor(hasContentDescription(ui.string(R.string.terminal_title)) and hasText("broski 42", substring = true))
    }

    /** New terminal in the folder on screen, until its shell has drawn its prompt, whatever the person's shell draws. */
    private fun openTerminalHere() {
        ui.tapIcon(ui.string(R.string.files_more))
        ui.tapText(ui.string(R.string.files_open_terminal))
        val drawn = SemanticsMatcher("shows output") { node ->
            node.config.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text.isNotBlank() }
        }
        ui.waitFor(hasContentDescription(ui.string(R.string.terminal_title)) and drawn)
    }

    private fun compose() = ui.compose
}
