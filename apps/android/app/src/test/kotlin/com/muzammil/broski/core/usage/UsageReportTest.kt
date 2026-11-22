package com.muzammil.broski.core.usage

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import uniffi.broski_contract.PlanMeter
import uniffi.broski_contract.UsageSpan
import uniffi.broski_contract.UsageWindow

class UsageReportTest {
    @get:Rule
    val temp = TemporaryFolder()

    @Test
    fun usedDropsToZeroPastResetAndPaceDetectsRunsOut() {
        val now = 10_000_000L
        val fiveHour = LimitSpan.FiveHour.durationMs
        // Halfway through the 5h window (elapsed = 0.5), already at 80% -> will run out before reset.
        val fast = LimitWindow(
            id = "session",
            span = LimitSpan.FiveHour,
            usedPercent = 80.0,
            resetsAtMs = now + fiveHour / 2,
        )
        assertEquals(0.80, fast.used(now), 0.001)
        assertEquals(0.50, fast.elapsed(now)!!, 0.001)
        val pace = fast.pace(now)
        assertTrue("expected RunsOut pace, got $pace", pace is UsagePace.RunsOut)

        // Past reset -> 0% used, null elapsed.
        val pastReset = fast.resetsAtMs!! + 1_000L
        assertEquals(0.0, fast.used(pastReset), 0.001)
        assertNull(fast.elapsed(pastReset))
    }

    @Test
    fun mergedPicksNewerReadingAcrossMachinesAndHeadlinePrefersFullest() {
        val older = PlanReport(
            plan = "claude",
            tier = "Max",
            windows = listOf(LimitWindow("s", LimitSpan.FiveHour, usedPercent = 20.0)),
            readAtMs = 1_000L,
            machineName = "Air",
        )
        val newer = older.copy(
            windows = listOf(
                LimitWindow("s", LimitSpan.FiveHour, usedPercent = 40.0),
                LimitWindow("w", LimitSpan.Week, usedPercent = 65.0),
            ),
            readAtMs = 2_000L,
            machineName = "Pro",
        )
        val merged = UsageReport.merged(listOf(older, newer))
        assertEquals(1, merged.size)
        assertEquals("Pro", merged.single().machineName)
        assertEquals("w", merged.single().headline(nowMs = 2_500L)?.id)
        assertFalse(merged.single().isStale(nowMs = 2_500L))
        assertTrue(merged.single().isStale(nowMs = 2_000L + 3L * 3_600_000L))
    }

    @Test
    fun storeRoundTripsUsageReportAtomically() {
        val store = UsageStore(File(temp.root, "usage_report.json"))
        assertNull(store.load())
        val report = UsageReport(
            plans = listOf(
                PlanReport(
                    plan = "codex",
                    displayName = "Codex",
                    tier = "Max 5x",
                    windows = listOf(
                        LimitWindow(
                            id = "session",
                            span = LimitSpan.FiveHour,
                            usedPercent = 38.5,
                            resetsAtMs = 20_000_000L,
                            history = listOf(UsagePoint(10_000_000L, 12.0), UsagePoint(15_000_000L, 38.5)),
                        ),
                    ),
                    readAtMs = 15_000_000L,
                    machineName = "Mac",
                ),
            ),
            savedAtMs = 15_000_000L,
        )
        store.save(report)
        val loaded = store.load()
        assertNotNull(loaded)
        assertEquals(report, loaded)
    }

    @Test
    fun anyPlanTheBridgeReadsIsReportedByItsOwnNameAfterClaudeAndAntigravity() {
        val window = UsageWindow("w", UsageSpan.WEEK, null, 10.0, null, null)
        val meters = listOf(
            PlanMeter("zed-pro", "Zed Pro", null, listOf(window), 3_000L, null),
            PlanMeter("antigravity", "Antigravity", "Pro", listOf(window), 2_000L, null),
            PlanMeter("cursor", null, null, listOf(window), 1_000L, null),
            PlanMeter("claude", "Claude", "Max", listOf(window), 1_000L, null),
        )
        val merged = UsageReport.merged(meters.map { PlanReport.from(it, "Mac") })
        assertEquals(listOf("claude", "antigravity", "cursor", "zed-pro"), merged.map { it.plan })
        assertEquals(listOf("Claude", "Antigravity", "Cursor", "Zed Pro"), merged.map { it.name })
    }

    @Test
    fun aReportAnOlderBuildStoredByEnumNameStillOpensAsWireIds() {
        val file = File(temp.root, "usage_report.json")
        file.writeText(
            """
            {"plans":[
              {"plan":"Claude","tier":"Max","windows":[],"machineName":"Mac"},
              {"plan":"Antigravity","windows":[],"machineName":"Mac"}
            ],"savedAtMs":5}
            """.trimIndent(),
        )
        val loaded = requireNotNull(UsageStore(file).load())
        assertEquals(listOf("claude", "antigravity"), loaded.plans.map { it.plan })
        assertEquals(listOf("Claude", "Antigravity"), loaded.plans.map { it.name })
    }
}
