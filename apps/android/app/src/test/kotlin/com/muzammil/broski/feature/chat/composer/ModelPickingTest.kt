package com.muzammil.broski.feature.chat.composer

import com.muzammil.broski.core.settings.ModelPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.broski_contract.ContractOption
import uniffi.broski_contract.ModeAxis
import uniffi.broski_contract.ModelSummary
import uniffi.broski_contract.ThinkingOption
import uniffi.broski_contract.ThinkingSpec

/** Picking a model from the composer: the pins and remembered levels, what the pill names, and which modes show beside it. */
class ModelPickingTest {
    @Test
    fun pinsKeepTheirOrderPerAgentUpToTheLimitAndSurviveBeingStored() {
        var preferences = ModelPreferences()
            .pinning(true, "anthropic/claude-opus-5-5", "pi")
            .pinning(true, "deepseek/deepseek-flash", "pi")
            .pinning(true, "anthropic/claude-opus-5-5", "pi")
            .pinning(true, "opus", "claude-code")
        assertEquals(listOf("anthropic/claude-opus-5-5", "deepseek/deepseek-flash"), preferences.pinned("pi"))
        assertEquals(listOf("opus"), preferences.pinned("claude-code"))

        repeat(20) { preferences = preferences.pinning(true, "openrouter/m$it", "pi") }
        assertEquals(ModelPreferences.PIN_LIMIT, preferences.pinned("pi").size)
        assertFalse(preferences.canPin("pi"))

        preferences = preferences.pinning(false, "anthropic/claude-opus-5-5", "pi").remembering("xhigh", "agy/gemini-4-neon", "pi")
        val stored = ModelPreferences.decoded(preferences.encoded())
        assertEquals("deepseek/deepseek-flash", stored.pinned("pi").first())
        assertEquals("xhigh", stored.level("agy/gemini-4-neon", "pi"))
        assertNull(stored.level("agy/gemini-4-neon", "claude-code"))
        assertEquals(ModelPreferences(), ModelPreferences.decoded("not json"))
    }

    @Test
    fun thePillNamesTheModelWithoutWhatTheAgentAddsInBrackets() {
        assertEquals("Default", model("Default (recommended)").pillName)
        assertEquals("Claude Opus 5.5", model("Claude Opus 5.5").pillName)
        assertEquals("(beta)", model("(beta)").pillName)
    }

    @Test
    fun theLevelIsNamedInWordsWithTheModelsDefaultStandingInForNone() {
        val spec = ThinkingSpec(listOf(ThinkingOption("medium", null, null), ThinkingOption("xhigh", "Extra high", null)), "medium")
        assertEquals("Extra high", spec.title("xhigh"))
        assertEquals("Medium", spec.title(null))
        assertNull(spec.title("max"))
    }

    @Test
    fun aModeShowsBesideThePillOnlyOffItsUsualValue() {
        val options = listOf(ContractOption("default", "Ask first", null), ContractOption("plan", "Plan", null))
        val permissions = ModeAxis("permissions", "Permissions", null, options, "default")
        assertNull(permissions.changedOption("default"))
        assertNull(permissions.changedOption(null))
        assertEquals("Plan", permissions.changedOption("plan")?.label)
        val noDefault = ModeAxis("permissions", "Permissions", null, options, null)
        assertNull(noDefault.changedOption("default"))
        assertEquals("Ask first", noDefault.title(null))
    }

    @Test
    fun whatThePersonPickedShowsUntilTheSessionReportsIt() {
        val settings = ComposerSettings(modelId = "fake-large", thinking = "high", modes = mapOf("permissions" to "default"))
            .showing(Picked(modelId = "fake-small", modes = mapOf("permissions" to "plan")))
        assertEquals("fake-small", settings.modelId)
        assertEquals("high", settings.thinking)
        assertEquals("plan", settings.modes["permissions"])
    }

    private fun model(name: String) = ModelSummary("m", name, null, null, null, null, null, ThinkingSpec(emptyList(), null), false, null)
}
