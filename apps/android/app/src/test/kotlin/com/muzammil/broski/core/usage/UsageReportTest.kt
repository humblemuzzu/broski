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
        assertEquals(UsageSeverity.High, fast.severity(now))

        // Past reset -> 0% used, null elapsed, empty trace.
        val pastReset = fast.resetsAtMs!! + 1_000L
        assertEquals(0.0, fast.used(pastReset), 0.001)
        assertNull(fast.elapsed(pastReset))
        assertTrue(fast.trace(pastReset).isEmpty())
    }

    @Test
    fun mergedPicksNewerReadingAcrossMachinesAndHeadlinePrefersFullest() {
        val older = PlanReport(
            plan = UsagePlan.Claude,
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
                    plan = UsagePlan.Claude,
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
}
