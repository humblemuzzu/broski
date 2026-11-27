package com.muzammil.broski.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BackendDescriptor
import uniffi.broski_contract.BackendIconHint
import uniffi.broski_contract.Capabilities

/** Which name, accent and art a backend id is shown with, from what each machine said of its backends. */
class AgentTest {
    private val capabilities = Capabilities(
        false, false, emptyList(), emptyList(), false, false, emptyList(), false, false, false, false, false, emptyList(), false, false, false,
    )

    private fun machine(id: String, vararg backends: BackendDescriptor) = MachineState(
        id = id,
        name = id,
        os = null,
        pairedAtMs = 0,
        health = MachineHealth.Online(null),
        lastSeenMs = null,
        bridgeVersion = null,
        agents = backends.map { AgentInstall(Agent.of(it), null) },
    )

    @Test
    fun aBackendIsShownAsItsMachineDescribesItAndAsItsIdAloneSaysElsewhere() {
        val machines = listOf(
            machine(
                "m-1",
                BackendDescriptor("codex", "Codex", "#10A37F", BackendIconHint.CODEX, capabilities),
                BackendDescriptor("claude-code", "Claude Code", "#D97757", null, capabilities),
                BackendDescriptor("pi", "Fake", "#6E56CF", BackendIconHint.GENERIC, capabilities),
                BackendDescriptor("antigravity", "Antigravity", "#1A73E8", BackendIconHint.ANTIGRAVITY, capabilities),
            ),
            machine("m-2"),
        )
        assertEquals(Agent("codex", "Codex", "#10A37F", BackendIconHint.CODEX), machines.agent("m-1", "codex"))
        assertEquals("Claude keeps its art when its descriptor names none", BackendIconHint.CLAUDE, machines.agent("m-1", "claude-code").icon)
        assertEquals("Pi keeps its art under any descriptor", Agent("pi", "Fake", "#6E56CF", BackendIconHint.PI), machines.agent("m-1", "pi"))
        assertEquals(Agent("antigravity", "Antigravity", "#1A73E8", BackendIconHint.ANTIGRAVITY), machines.agent("m-1", "antigravity"))

        assertEquals(Agent("pi", "Pi", icon = BackendIconHint.PI), machines.agent("m-2", "pi"))
        assertEquals(Agent("claude-code", "Claude Code", icon = BackendIconHint.CLAUDE), machines.agent("m-2", "claude-code"))
        assertEquals(Agent("antigravity", "Antigravity", icon = BackendIconHint.ANTIGRAVITY), machines.agent("m-2", "antigravity"))
        assertEquals(Agent("codex", "Codex"), machines.agent("m-2", "codex"))
        assertEquals(Agent("open-code", "Open Code"), machines.agent("forgotten", "open-code"))
    }

    @Test
    fun onlyTheContractsSpellingIsABackendId() {
        listOf("claude-code", "pi", "codex", "9lives", "a-", "x".repeat(64)).forEach { assertTrue(it, BackendIds.isValid(it)) }
        listOf("", "CLAUDE_CODE", "PI", "-pi", "pi_x", "../pi", "pi\n", "x".repeat(65)).forEach { assertFalse(it, BackendIds.isValid(it)) }
    }
}
