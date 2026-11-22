package com.muzammil.broski.feature.newsession

import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.core.BackendIds
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.broski_contract.AuthState
import uniffi.broski_contract.BackendStatus
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState
import uniffi.broski_core.WaitReason

/** What a new session starts with before the person picks anything, and what their picks keep. */
class NewSessionChoiceTest {
    private fun row(machine: String, cwd: String?, updatedAt: Long, backend: String = BackendIds.PI) =
        InboxRow(machine, "studio", SessionRef(backend, "s$updatedAt"), null, cwd, InboxState.IDLE, updatedAt, null, null, null, null, false)

    private fun status(usable: Boolean) = BackendStatus(usable, "1.0", AuthState.SIGNED_IN, usable, emptyList())

    private fun machine(id: String, online: Boolean = true, claude: Boolean? = true, pi: Boolean? = true) = MachineState(
        id = id,
        name = id,
        os = null,
        pairedAtMs = 0,
        health = if (online) MachineHealth.Online(null) else MachineHealth.Waiting(WaitReason.MACHINE_OFFLINE),
        lastSeenMs = null,
        bridgeVersion = null,
        agents = listOf(
            AgentInstall(Agent.known(BackendIds.CLAUDE_CODE), claude?.let(::status)),
            AgentInstall(Agent.known(BackendIds.PI), pi?.let(::status)),
        ),
    )

    @Test
    fun projectsAreEveryAgentsFoldersOnTheMacNewestFirstEachOnce() {
        val rows = listOf(
            row("m", "/w/app", 10, BackendIds.CLAUDE_CODE),
            row("m", "/w/site", 30, BackendIds.PI),
            row("m", "/w/app", 20, BackendIds.PI),
            row("m", null, 40),
            row("other", "/elsewhere", 50),
        )
        assertEquals(listOf("/w/site" to 30L, "/w/app" to 20L), projects(rows, "m").map { it.path to it.updatedAt })
    }

    @Test
    fun aFreshChoiceTakesAnOnlineMacItsNewestFolderAndTheAgentLastUsedThere() {
        val rows = listOf(row("b", "/w/site", 30, BackendIds.CLAUDE_CODE), row("b", "/w/app", 20, BackendIds.PI))
        val choice = settled(Choice(), listOf(machine("a", online = false), machine("b")), rows)
        assertEquals("b", choice.machineId)
        assertEquals("/w/site", choice.folder)
        assertEquals(BackendIds.CLAUDE_CODE, choice.backend)
        assertFalse(choice.agentPicked)
    }

    @Test
    fun theAgentFollowsTheFolderUntilThePersonPicksOne() {
        val rows = listOf(row("m", "/w/site", 30, BackendIds.CLAUDE_CODE), row("m", "/w/app", 20, BackendIds.PI))
        val machines = listOf(machine("m"))
        val start = settled(Choice(), machines, rows)
        assertEquals(BackendIds.PI, settled(start.copy(folder = "/w/app"), machines, rows).backend)

        val picked = settled(start.copy(backend = BackendIds.PI, agentPicked = true), machines, rows)
        assertEquals("a picked agent stays wherever the folder goes", BackendIds.PI, settled(picked.copy(folder = "/w/site"), machines, rows).backend)
    }

    @Test
    fun anAgentThatCannotRunGivesWayAndTakesItsSettingsWithIt() {
        val rows = listOf(row("m", "/w/app", 10, BackendIds.CLAUDE_CODE))
        val picked = Choice(machineId = "m", folder = "/w/app", backend = BackendIds.CLAUDE_CODE, agentPicked = true, modelId = "opus")
        val choice = settled(picked, listOf(machine("m", claude = false)), rows)
        assertEquals(BackendIds.PI, choice.backend)
        assertFalse(choice.agentPicked)
        assertNull("the model was Claude Code's", choice.modelId)
    }

    @Test
    fun aMacWithNoSessionsStartsWithNoFolderAndAnAgentWhoseStatusHasNotComeYet() {
        val choice = settled(Choice(), listOf(machine("m", claude = null, pi = false)), emptyList())
        assertNull("nowhere is a guess; the person picks", choice.folder)
        assertEquals(BackendIds.CLAUDE_CODE, choice.backend)
    }
}
