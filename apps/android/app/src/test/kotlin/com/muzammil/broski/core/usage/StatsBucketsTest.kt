package com.muzammil.broski.core.usage

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.StatsHarness
import uniffi.broski_contract.StatsResolution
import uniffi.broski_contract.StatsSeriesPoint
import uniffi.broski_contract.StatsSeriesSlice

class StatsBucketsTest {
    private val zone = ZoneId.of("UTC")

    private fun point(key: String, cost: Double, tokens: Long, vararg slices: Pair<StatsHarness, Double>) = StatsSeriesPoint(
        key = key,
        label = key,
        costUsd = cost,
        totalTokens = tokens,
        turns = 2,
        cacheRead = 0,
        cacheDenom = 0,
        byHarness = slices.map { (harness, usd) -> StatsSeriesSlice(harness, usd, tokens / 2, 1) },
    )

    private fun days(count: Int): List<StatsSeriesPoint> =
        (0 until count).map { point(LocalDate.of(2026, 1, 1).plusDays(it.toLong()).toString(), 1.0, 10) }

    @Test
    fun aShortDaySeriesStaysOneBucketPerDay() {
        val buckets = StatsBuckets(days(30), StatsResolution.DAY, zone, DayOfWeek.MONDAY)
        assertEquals(StatsBuckets.Unit.DAY, buckets.unit)
        assertEquals(30, buckets.buckets.size)
    }

    @Test
    fun aSeriesLongerThanOneHundredTwentyDaysIsDrawnByWeek() {
        val buckets = StatsBuckets(days(121), StatsResolution.DAY, zone, DayOfWeek.MONDAY)
        assertEquals(StatsBuckets.Unit.WEEK, buckets.unit)
        val first = buckets.buckets.first()
        assertEquals(DayOfWeek.MONDAY, first.start.dayOfWeek)
        assertEquals(LocalDate.of(2025, 12, 29), first.start.toLocalDate())
        assertEquals(4.0, first.costUsd, 0.0)
        assertEquals(121.0, buckets.buckets.sumOf { it.costUsd }, 0.0)
        assertEquals(242L, buckets.buckets.sumOf { it.turns })
    }

    @Test
    fun theWeekStartsOnTheLocalesFirstDay() {
        val sunday = StatsBuckets(days(121), StatsResolution.DAY, zone, DayOfWeek.SUNDAY)
        assertEquals(LocalDate.of(2025, 12, 28), sunday.buckets.first().start.toLocalDate())
    }

    @Test
    fun hourlyKeysAreUtcMomentsShownInTheZone() {
        val series = listOf(point("2026-11-17T14", 1.0, 10), point("2026-11-17T15", 2.0, 20))
        val buckets = StatsBuckets(series, StatsResolution.HOUR, ZoneId.of("Asia/Karachi"), DayOfWeek.MONDAY)
        assertEquals(StatsBuckets.Unit.HOUR, buckets.unit)
        assertEquals(19, buckets.buckets.first().start.hour)
        assertEquals(14, buckets.buckets.first().start.withZoneSameInstant(ZoneOffset.UTC).hour)
    }

    @Test
    fun aBucketAddsEachAgentsSlicesAcrossItsPoints() {
        val series = (0 until 121).map {
            point(LocalDate.of(2026, 1, 1).plusDays(it.toLong()).toString(), 3.0, 10, StatsHarness.CLAUDE to 2.0, StatsHarness.PI to 1.0)
        }
        val week = StatsBuckets(series, StatsResolution.DAY, zone, DayOfWeek.MONDAY).buckets.first()
        assertEquals(listOf(StatsHarness.CLAUDE, StatsHarness.PI), week.slices.map { it.harness })
        assertEquals(8.0, week.slices.first().costUsd, 0.0)
        assertEquals(20L, week.slices.first().tokens)
    }

    @Test
    fun aKeyThatIsNotADateIsSkipped() {
        val buckets = StatsBuckets(listOf(point("soon", 1.0, 1), point("2026-01-01", 1.0, 1)), StatsResolution.DAY, zone, DayOfWeek.MONDAY)
        assertEquals(1, buckets.buckets.size)
    }

    @Test
    fun theCurrentBucketCoversNowAndNoOtherDoes() {
        val buckets = StatsBuckets(days(121), StatsResolution.DAY, zone, DayOfWeek.MONDAY)
        val now = ZonedDateTime.of(2026, 1, 14, 9, 0, 0, 0, zone)
        val covering = buckets.buckets.filter { buckets.covers(it, now) }
        assertEquals(1, covering.size)
        assertEquals(LocalDate.of(2026, 1, 12), covering.single().start.toLocalDate())
        assertFalse(buckets.covers(buckets.buckets.first(), now))
        assertTrue(buckets.covers(buckets.buckets.last(), buckets.buckets.last().start.plusDays(6)))
    }
}
