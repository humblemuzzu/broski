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
        val merged = Picked(modelId = "fake-small").merge(Picked(thinking = "low", modes = mapOf("permissions" to "plan")))
        val settings = ComposerSettings(
            models = listOf(summary("fake-large"), summary("fake-small")),
            modelId = "fake-large",
            thinking = "high",
            modes = mapOf("permissions" to "default"),
        ).showing(merged)
        assertEquals("fake-small", settings.modelId)
        assertEquals("low", settings.thinking)
        assertEquals("plan", settings.modes["permissions"])
        assertNull(merged.merge(Picked(modelId = "fake-other")).thinking)
        assertEquals("fake-large", ComposerSettings(models = listOf(summary("fake-large")), modelId = "unlisted-wire-id").model?.id)
    }

    @Test
    fun theWheelKeepsTheModelItOpenedOnAheadOfThePinsAndPinnedOnesInTheirPlace() {
        val models = listOf(summary("a"), summary("b"), summary("c"), summary("d"))
        assertEquals(listOf("c", "a", "b"), wheelModels(models, listOf("a", "b", "gone"), "c", listsAll = false).map { it.id })
        assertEquals(listOf("a", "b"), wheelModels(models, listOf("a", "b"), "b", listsAll = false).map { it.id })
        assertEquals(listOf("a", "b", "c", "d"), wheelModels(models, emptyList(), "c", listsAll = true).map { it.id })
    }

    @Test
    fun theDrumTurnsRowsAwayAndATapFindsTheRowItShows() {
        assertEquals(0f, Drum.shown(0f), 0.0001f)
        assertEquals(0.96f, Drum.shown(1f), 0.01f)
        assertEquals(1.70f, Drum.shown(2f), 0.01f)
        for (d in listOf(-2f, -1.3f, 0f, 0.4f, 1f, 2f)) assertEquals(d, Drum.under(Drum.shown(d)), 0.001f)
        assertEquals(1f, Drum.alpha(0f), 0f)
        assertEquals(0f, Drum.alpha(3f), 0f)
        assertEquals(0f, Drum.detailAlpha(0.5f), 0f)
        assertEquals(-0.3f, Drum.dragged(0f, -1f, 4), 0.0001f)
        assertEquals(2.5f, Drum.dragged(2f, 0.5f, 4), 0.0001f)
        assertEquals(4.6f, Drum.dragged(4.5f, 3f, 4), 0.0001f)
    }

    @Test
    fun theTrackSpacesLevelsEvenlyAndSnapsToTheNearest() {
        val track = LevelTrack(count = 5, width = 366f, lead = 44f, trail = 22f)
        assertEquals(44f, track.x(0), 0f)
        assertEquals(344f, track.x(4), 0.001f)
        assertEquals(119f, track.x(1), 0.001f)
        assertEquals(0, track.nearest(-50f))
        assertEquals(1, track.nearest(150f))
        assertEquals(2, track.nearest(160f))
        assertEquals(4, track.nearest(1000f))
        assertEquals(0, LevelTrack(count = 1, width = 300f, lead = 44f, trail = 22f).nearest(200f))
    }

    private fun summary(id: String) = ModelSummary(id, id, null, null, null, null, null, ThinkingSpec(emptyList(), null), false, null)

    private fun model(name: String) = ModelSummary("m", name, null, null, null, null, null, ThinkingSpec(emptyList(), null), false, null)
}
