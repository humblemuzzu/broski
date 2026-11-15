package com.muzammil.broski

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

/** The Workspace on the real machine's served repository, driven through the UI. */
@OptIn(ExperimentalTestApi::class)
class WorkspaceFlows(private val ui: WorkspaceUiDriver, private val machine: RealMachine) {
    private val client get() = WorkspaceClient(requireNotNull(machine.phone.machine(machine.machineId))::request)

    fun files() {
        ui.openWorkspace(R.string.workspace_tab_files)
        ui.tapText(ui.rootName)
        ui.waitFor(hasText("README.md"))
        ui.waitFor(hasText("src"))
        Shots.save("files-light")

        ui.tapText("README.md")
        ui.waitFor(hasText("A repository for the app tests, edited."))
        Shots.save("file-light")
        ui.back()

        ui.tapIcon(ui.string(R.string.files_search))
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
        ui.openWorkspace(R.string.workspace_tab_files)
        Shots.save("workspace-$suffix")
        ui.tapText(ui.rootName)
        ui.waitFor(hasText("README.md"))
        Shots.save("files-$suffix")
        ui.tapText("README.md")
        ui.waitFor(hasText("A repository for the app tests, edited."))
        Shots.save("file-$suffix")
        ui.back()
        ui.back()
        ui.openWorkspace(R.string.workspace_tab_git)
        ui.tapText(ui.rootName)
        ui.waitFor(hasText("untracked.txt"))
        Shots.save("git-$suffix")
        ui.tapText("README.md")
        ui.waitFor(hasText("+Another line."))
        Shots.save("diff-$suffix")
        ui.back()
        ui.back()
        openTerminal()
        Shots.save("terminal-$suffix")
        ui.back()
    }

    fun git() {
        ui.openWorkspace(R.string.workspace_tab_git)
        ui.tapText(ui.rootName)
        ui.waitFor(hasText("untracked.txt"))
        Shots.save("git-light")
        ui.tapText("README.md")
        ui.waitFor(hasText("+Another line."))
        ui.waitFor(hasText("-A repository for the app tests."))
        Shots.save("diff-light")
        ui.back()

        compose().onAllNodes(hasText("README.md"))[0].performTouchInput { swipeRight() }
        ui.waitFor(hasText(ui.string(R.string.git_section_staged, 1)))
        compose().onAllNodes(hasSetTextAction())[0].performTextInput("Edit the readme from the phone")
        ui.tapText(machine.context.resources.getQuantityString(R.plurals.git_commit, 1, 1))
        ui.waitFor(hasText("Edit the readme from the phone") and !hasSetTextAction())
        Shots.save("git-committed-light")

        val status = (runBlocking { client.status(machine.root) } as Answer.Done).value
        assertTrue("nothing is left staged or changed", status.staged.isEmpty() && status.unstaged.isEmpty())
        val log = (runBlocking { client.log(machine.root, 1) } as Answer.Done).value
        assertEquals("Edit the readme from the phone", log.commits.single().subject)
    }

    fun terminal() {
        openTerminal()
        InstrumentationRegistry.getInstrumentation().sendStringSync("echo broski \$((6*7))\n")
        ui.waitFor(hasContentDescription(ui.string(R.string.terminal_title)) and hasText("broski 42", substring = true))
        Shots.save("terminal-light")
    }

    /** New terminal in the served folder, until its shell has drawn its prompt, whatever the person's shell draws. */
    private fun openTerminal() {
        ui.openWorkspace(R.string.workspace_tab_terminal)
        ui.tapText(ui.string(R.string.terminal_new))
        ui.tap(hasText(ui.rootName) and hasClickAction() and hasAnyAncestor(isDialog()))
        val drawn = SemanticsMatcher("shows output") { node ->
            node.config.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text.isNotBlank() }
        }
        ui.waitFor(hasContentDescription(ui.string(R.string.terminal_title)) and drawn)
    }

    private fun compose() = ui.compose
}
