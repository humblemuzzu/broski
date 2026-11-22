package com.muzammil.broski.feature.chat.header

import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.feature.chat.ChatHeader
import com.muzammil.broski.feature.chat.EmptySnapshot
import com.muzammil.broski.feature.chat.composer.Catalog
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.broski_contract.ContractOption
import uniffi.broski_contract.ModeAxis
import uniffi.broski_contract.ModeSetting
import uniffi.broski_contract.ModelSummary
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.ThinkingOption
import uniffi.broski_contract.ThinkingSpec
import uniffi.broski_contract.Usage

class SessionInfoTest {
    private val header = ChatHeader("Fix the flaky test", Agent("claude-code", "Claude Code"), "/Users/me/broski", "Studio Mac", null)
    private val session = SessionRef("claude-code", "s-1")

    private val catalog = Catalog(
        models = listOf(
            ModelSummary(
                "claude-opus", "Opus", null, null, null, 200_000, null,
                ThinkingSpec(listOf(ThinkingOption("high", "Think hard", null)), null), isDefault = false, unavailableReason = null,
            ),
        ),
        modes = listOf(ModeAxis("permissions", "Permissions", null, listOf(ContractOption("plan", "Plan mode", null)), null)),
    )

    private fun usage(contextTokens: Long? = null, contextWindow: Long? = null, costUsd: Double? = null) =
        Usage(12_345, 678, null, 4_000, null, costUsd, contextTokens, contextWindow, null)

    @Test
    fun theCatalogNamesTheModelItsThinkingAndModesAndTheWindowFallsBackToTheModels() {
        val snapshot = EmptySnapshot.copy(
            modelId = "claude-opus",
            thinking = "high",
            modes = listOf(ModeSetting("permissions", "plan"), ModeSetting("sandbox", "strict")),
            usage = usage(contextTokens = 64_000),
        )
        val info = sessionInfo(header, session, snapshot, catalog)
        assertEquals("Opus" to "claude-opus", info.model to info.modelId)
        assertEquals("Think hard", info.thinking)
        assertEquals(listOf("Permissions" to "Plan mode", "sandbox" to "strict"), info.modes)
        assertEquals(200_000L, info.contextWindow)
        assertEquals("s-1" to "/Users/me/broski", info.sessionId to info.cwd)
    }

    @Test
    fun aModelTheCatalogDoesNotListIsShownByItsIdOnce() {
        val info = sessionInfo(header, session, EmptySnapshot.copy(modelId = "gpt-x", thinking = "max", usage = usage(contextWindow = 1_000)), catalog)
        assertEquals("gpt-x", info.model)
        assertNull(info.modelId)
        assertEquals("max", info.thinking)
        assertEquals("the snapshot's own window wins", 1_000L, info.contextWindow)
    }

    @Test
    fun theContextFillReadsAsUsedOverWindowWithItsShare() {
        assertEquals(ContextFill("64k / 200k", 0.32f, 32), contextFill(64_000, 200_000))
        assertEquals("never past full", 100, contextFill(250_000, 200_000)?.percent)
        assertNull(contextFill(64_000, null))
        assertNull(contextFill(64_000, 0))
        assertNull(contextFill(null, 200_000))
    }

    @Test
    fun onlyReportedTotalsAreListedAndTheCostReadsInDollars() {
        assertEquals(
            listOf(
                UsageFact(R.string.info_input, "12,345"),
                UsageFact(R.string.info_output, "678"),
                UsageFact(R.string.info_cache_write, "4,000"),
                UsageFact(R.string.info_cost, "$0.42"),
            ),
            usage(costUsd = 0.4195).facts(Locale.US),
        )
        assertEquals("<$0.01", cost(0.0021))
        assertEquals("$0.00", cost(0.0))
        assertEquals("$12.50", cost(12.5))
    }
}
