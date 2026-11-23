package com.muzammil.broski.core.usage

import java.time.DateTimeException
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters
import java.time.temporal.WeekFields
import java.util.Locale
import uniffi.broski_contract.StatsHarness
import uniffi.broski_contract.StatsResolution
import uniffi.broski_contract.StatsSeriesPoint

/**
 * The series as the chart draws it: one bucket per hour, day or week, each with what every agent
 * spent in it. A day series longer than [DAYS_UP_TO] is drawn by week, so a year reads as a shape
 * rather than a comb.
 */
class StatsBuckets(
    series: List<StatsSeriesPoint>,
    resolution: StatsResolution,
    zone: ZoneId = ZoneId.systemDefault(),
    firstDayOfWeek: DayOfWeek = WeekFields.of(Locale.getDefault()).firstDayOfWeek,
) {
    enum class Unit { HOUR, DAY, WEEK }

    data class Slice(val harness: StatsHarness, val costUsd: Double, val tokens: Long)

    data class Bucket(
        val start: ZonedDateTime,
        val costUsd: Double,
        val tokens: Long,
        val turns: Long,
        val slices: List<Slice>,
    ) {
        fun value(metric: StatsMetric): Double = if (metric == StatsMetric.COST) costUsd else tokens.toDouble()

        fun plus(point: StatsSeriesPoint): Bucket {
            val merged = slices.toMutableList()
            for (slice in point.byHarness) {
                val index = merged.indexOfFirst { it.harness == slice.harness }
                if (index >= 0) {
                    val kept = merged[index]
                    merged[index] = Slice(kept.harness, kept.costUsd + slice.costUsd, kept.tokens + slice.totalTokens)
                } else {
                    merged += Slice(slice.harness, slice.costUsd, slice.totalTokens)
                }
            }
            return copy(costUsd = costUsd + point.costUsd, tokens = tokens + point.totalTokens, turns = turns + point.turns, slices = merged)
        }
    }

    val unit: Unit = when {
        resolution == StatsResolution.HOUR -> Unit.HOUR
        series.size > DAYS_UP_TO -> Unit.WEEK
        else -> Unit.DAY
    }

    val buckets: List<Bucket> = buildList {
        for (point in series) {
            val date = moment(point.key, unit, zone) ?: continue
            val start = if (unit == Unit.WEEK) {
                date.toLocalDate().with(TemporalAdjusters.previousOrSame(firstDayOfWeek)).atStartOfDay(zone)
            } else {
                date
            }
            val last = lastIndex
            if (last >= 0 && this[last].start == start) {
                this[last] = this[last].plus(point)
            } else {
                add(Bucket(start, 0.0, 0L, 0L, emptyList()).plus(point))
            }
        }
    }

    /** Whether [moment] falls within [bucket]'s hour, day or week. */
    fun covers(bucket: Bucket, moment: ZonedDateTime): Boolean {
        val end = when (unit) {
            Unit.HOUR -> bucket.start.plusHours(1)
            Unit.DAY -> bucket.start.plusDays(1)
            Unit.WEEK -> bucket.start.plusWeeks(1)
        }
        return !moment.isBefore(bucket.start) && moment.isBefore(end)
    }

    companion object {
        const val DAYS_UP_TO = 120

        /** A day key, "2026-11-17", is the Mac's day in the phone's time zone; an hour key, "2026-11-17T14", is UTC. */
        private fun moment(key: String, unit: Unit, zone: ZoneId): ZonedDateTime? = try {
            if (unit == Unit.HOUR) {
                LocalDateTime.parse("$key:00:00").atOffset(ZoneOffset.UTC).atZoneSameInstant(zone)
            } else {
                LocalDate.parse(key).atStartOfDay(zone)
            }
        } catch (_: DateTimeException) {
            null
        }
    }
}
