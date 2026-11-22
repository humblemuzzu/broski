package com.muzammil.broski.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Test
import uniffi.broski_contract.CacheConfidence
import uniffi.broski_contract.CacheWindow

/** The prompt cache's clock as the phone counts it from the window the bridge sent: the same numbers and words as the iOS chat. */
class CacheStatusTest {
    private val touched = 1_000_000L

    private fun window(
        ttl: Long? = 300_000,
        confidence: CacheConfidence? = CacheConfidence.EXACT,
        cached: Long? = 142_318,
        prompt: Long? = 151_000,
    ) = CacheWindow(touched, ttl, confidence, cached, prompt)

    @Test
    fun theHitRateIsTheCachedShareOfThePromptRoundedAndBounded() {
        assertEquals(94, window().hitPercent)
        assertEquals(33, window(cached = 1, prompt = 3).hitPercent)
        assertEquals(67, window(cached = 2, prompt = 3).hitPercent)
        assertEquals("a half rounds up", 13, window(cached = 1, prompt = 8).hitPercent)
        assertEquals(100, window(cached = 300, prompt = 100).hitPercent)
        assertEquals(0, window(cached = -5, prompt = 100).hitPercent)
        assertNull(window(cached = 10, prompt = 0).hitPercent)
        assertNull(window(cached = null).hitPercent)
        assertNull(window(prompt = null).hitPercent)
    }

    @Test
    fun itIsWarmUntilTheLastMillisecondThenOnlyTheHitRateIsLeft() {
        assertEquals(CacheStatus.Warm(1, false, 94), cacheStatus(window(), touched + 299_999))
        assertEquals(CacheStatus.HitOnly(94), cacheStatus(window(), touched + 300_000))
        assertEquals(CacheStatus.HitOnly(94), cacheStatus(window(), touched + 900_000))
        assertNull("nothing was ever read from it", cacheStatus(window(cached = 0), touched + 300_000))
        assertEquals(touched + 300_000, window().expiresAtMs)
        assertEquals("a phone clock behind the Mac's does not stretch it", 300_000L, window().remainingMs(touched - 60_000))
    }

    @Test
    fun noLifetimeIsNeverATimer() {
        assertEquals(CacheStatus.HitOnly(94), cacheStatus(window(ttl = null), touched))
        assertNull(cacheStatus(window(ttl = null, cached = 0), touched))
        assertNull(cacheStatus(window(ttl = null, prompt = null), touched))
        assertEquals(CacheStatus.HitOnly(94), cacheStatus(window(ttl = 0), touched))
        assertNull(cacheStatus(null, touched))
        assertNull(window(ttl = null).expiresAtMs)
        assertNull(window(ttl = null).remainingMs(touched))
    }

    @Test
    fun aWarmWindowCarriesItsConfidenceAndAHitRateOnlyWhenKnown() {
        assertEquals(CacheStatus.Warm(300_000, true, 94), cacheStatus(window(confidence = CacheConfidence.ESTIMATED), touched))
        assertEquals(CacheStatus.Warm(300_000, false, 94), cacheStatus(window(confidence = null), touched))
        assertEquals(CacheStatus.Warm(300_000, false, 0), cacheStatus(window(cached = 0), touched))
        assertEquals(CacheStatus.Warm(300_000, false, null), cacheStatus(window(prompt = null), touched))
    }

    @Test
    fun itTurnsAmberInItsLastMinute() {
        assertEquals(CacheTone.CALM, CacheStatus.Warm(60_001, false, null).tone)
        assertEquals(CacheTone.EXPIRING, CacheStatus.Warm(60_000, false, null).tone)
        assertEquals(CacheTone.QUIET, CacheStatus.HitOnly(91).tone)
    }

    @Test
    fun exactTimesCountSecondsAndEstimatesDropThem() {
        assertEquals("1h 02m", cacheDuration(3_722_000, estimated = false))
        assertEquals("1h 00m", cacheDuration(3_600_000, estimated = false))
        assertEquals("3m 42s", cacheDuration(222_000, estimated = false))
        assertEquals("whole seconds count up", "3m 42s", cacheDuration(221_001, estimated = false))
        assertEquals("1m 05s", cacheDuration(65_000, estimated = false))
        assertEquals("1m 00s", cacheDuration(60_000, estimated = false))
        assertEquals("1m 00s", cacheDuration(59_999, estimated = false))
        assertEquals("42s", cacheDuration(42_000, estimated = false))
        assertEquals("1s", cacheDuration(1, estimated = false))
        assertEquals("~3m", cacheDuration(222_000, estimated = true))
        assertEquals("~1h 02m", cacheDuration(3_722_000, estimated = true))
        assertEquals("~42s", cacheDuration(42_000, estimated = true))
    }

    @Test
    fun theHeaderSaysTheWindowInFewWords() {
        assertEquals("Cache 3m 42s · 94%", CacheStatus.Warm(222_000, false, 94).compact)
        assertEquals("Cache ~3m", CacheStatus.Warm(222_000, true, null).compact)
        assertEquals("91% cached", CacheStatus.HitOnly(91).compact)
    }

    @Test
    fun switchingModelsWarnsOnlyWhileAtLeast20kTokensAreWarm() {
        val now = touched + 300_000 - 222_000
        assertEquals("Cache warm (142k tokens, 3m 42s left) — switching models will re-cache", window().switchWarning(now))
        assertEquals(
            "Cache warm (142k tokens, ~3m left) — switching models will re-cache",
            window(confidence = CacheConfidence.ESTIMATED).switchWarning(now),
        )
        assertTrue(window(cached = 20_000).shouldWarnOnModelSwitch(now))
        assertFalse(window(cached = 19_999).shouldWarnOnModelSwitch(now))
        assertFalse(window(cached = null).shouldWarnOnModelSwitch(now))
        assertFalse(window().shouldWarnOnModelSwitch(touched + 300_000))
        assertFalse(window(ttl = null).shouldWarnOnModelSwitch(now))
        assertNull(window(ttl = null).switchWarning(now))
        assertFalse(window(ttl = null).warnsOnModelSwitch)
        assertTrue(window().warnsOnModelSwitch)
    }

    @Test
    fun tokenCountsAreShort() {
        assertEquals("842", compactTokens(842))
        assertEquals("142k", compactTokens(142_318))
        assertEquals("999k", compactTokens(999_999))
        assertEquals("1.2M", compactTokens(1_240_000))
    }

    @Test
    fun theOverflowGivesTheNumbersAndATimeOfDay() {
        val clock: (Long) -> String = { "T$it" }
        assertEquals(listOf("142k of 151k prompt tokens cached (94%)", "Expires T1300000"), window().breakdown(clock))
        assertEquals(listOf("Expires about T1300000"), window(confidence = CacheConfidence.ESTIMATED, prompt = null).breakdown(clock))
        assertEquals(listOf("142k of 151k prompt tokens cached (94%)"), window(ttl = null).breakdown(clock))
        assertTrue(window(ttl = null, cached = 0).breakdown(clock).isEmpty())
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun theClockWakesAsEachSecondFallsThenStops() = runTest {
        assertEquals(listOf(1_000L, 500L, 1L, 1L, 1L), listOf(3_000L, 2_500L, 1_001L, 1L, 0L).map(::nextCacheTickMs))
        val clock = { testScheduler.currentTime }
        val ticks = mutableListOf<Long>()
        tickCacheClock(2_500, clock) { ticks += it }
        assertEquals(listOf(0L, 500L, 1_500L, 2_500L), ticks)
        val idle = mutableListOf<Long>()
        tickCacheClock(null, clock) { idle += it }
        tickCacheClock(0, clock) { idle += it }
        assertEquals("no lifetime, or an expired one, reads the clock once", listOf(2_500L, 2_500L), idle)
    }
}
