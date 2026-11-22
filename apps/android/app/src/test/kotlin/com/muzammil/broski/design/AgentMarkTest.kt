package com.muzammil.broski.design

import androidx.compose.ui.graphics.Color
import com.muzammil.broski.core.Agent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The tile of an agent the app has no logo for: its initials, on its descriptor's accent when that is one. */
class AgentMarkTest {
    @Test
    fun theTileReadsTheFirstLettersOfTheAgentsFirstTwoWords() {
        assertEquals("GC", monogram(Agent("gemini", "Gemini CLI")))
        assertEquals("C", monogram(Agent("codex", "Codex")))
        assertEquals("OC", monogram(Agent("open-code", "Open Code Agent")))
        assertEquals("a name with no letters falls back to the id", "X", monogram(Agent("x-agent", "✦ ✦")))
    }

    @Test
    fun onlyAHashAndSixHexDigitsIsAnAccent() {
        assertEquals(Color(0xFF10A37F), accentColor("#10a37f"))
        listOf(null, "", "10A37F", "#10A37", "#10A37FF", "#GGGGGG", "#-10A37").forEach { assertNull(it, accentColor(it)) }
    }
}
