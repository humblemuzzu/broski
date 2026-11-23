package com.muzammil.broski.feature.usage

import android.content.res.Resources
import android.text.format.DateFormat
import com.muzammil.broski.R
import com.muzammil.broski.core.usage.StatsBuckets
import com.muzammil.broski.core.usage.StatsMetric
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import uniffi.broski_contract.StatsCostSource
import uniffi.broski_contract.StatsRange
import uniffi.broski_contract.StatsScanState
import uniffi.broski_contract.StatsSummary

fun Resources.turns(count: Long): String = getQuantityString(R.plurals.stats_turns, count.toInt(), "%,d".format(count))

fun Resources.sessions(count: Long): String = getQuantityString(R.plurals.stats_sessions, count.toInt(), "%,d".format(count))

fun Resources.runs(count: Long): String = getQuantityString(R.plurals.stats_runs, count.toInt(), "%,d".format(count))

/** The period a change is measured against: "the previous 30 days"; null where there is no before. */
fun StatsRange.previousPeriod(resources: Resources): String? = when (this) {
    StatsRange.DAY -> resources.getString(R.string.stats_previous_day)
    StatsRange.WEEK -> resources.getString(R.string.stats_previous_week)
    StatsRange.MONTH -> resources.getString(R.string.stats_previous_month)
    StatsRange.QUARTER -> resources.getString(R.string.stats_previous_quarter)
    StatsRange.YEAR -> resources.getString(R.string.stats_previous_year)
    StatsRange.ALL -> null
}

fun StatsBuckets.Unit.perBucket(resources: Resources): String = resources.getString(
    when (this) {
        StatsBuckets.Unit.HOUR -> R.string.stats_per_hour
        StatsBuckets.Unit.DAY -> R.string.stats_per_day
        StatsBuckets.Unit.WEEK -> R.string.stats_per_week
    },
)

/** A bucket's first moment where a finger reads it: "Mon 2 PM", "Mon, Nov 17", "Week of Nov 16". */
fun StatsBuckets.Unit.pickedDate(resources: Resources, start: ZonedDateTime): String = when (this) {
    StatsBuckets.Unit.HOUR -> formatter("EEEj").format(start)
    StatsBuckets.Unit.DAY -> formatter("EEEMMMd").format(start)
    StatsBuckets.Unit.WEEK -> resources.getString(R.string.stats_week_of, formatter("MMMd").format(start))
}

/** The chart's first and last moments under its edges; the last reads "Now", "Today" or "This week" while it is current. */
fun StatsBuckets.edgeLabel(resources: Resources, bucket: StatsBuckets.Bucket, isLast: Boolean, now: ZonedDateTime): String {
    if (isLast && covers(bucket, now)) {
        return resources.getString(
            when (unit) {
                StatsBuckets.Unit.HOUR -> R.string.stats_edge_now
                StatsBuckets.Unit.DAY -> R.string.stats_edge_today
                StatsBuckets.Unit.WEEK -> R.string.stats_edge_this_week
            },
        )
    }
    return formatter(if (unit == StatsBuckets.Unit.HOUR) "j" else "MMMd").format(bucket.start)
}

fun trendCaption(resources: Resources, summary: StatsSummary, metric: StatsMetric, picked: StatsBuckets.Bucket?, unit: StatsBuckets.Unit): String {
    if (picked != null) return unit.pickedDate(resources, picked.start)
    val what = resources.getString(if (metric == StatsMetric.COST) R.string.stats_caption_spent else R.string.stats_caption_tokens)
    val only = summary.harnesses.singleOrNull() ?: return what
    return resources.getString(R.string.stats_caption_agent, only.displayName, what)
}

fun trendFigure(summary: StatsSummary, metric: StatsMetric, picked: StatsBuckets.Bucket?): String {
    val value = picked?.value(metric)
        ?: if (metric == StatsMetric.COST) summary.totals.cost.total else summary.totals.tokens.totalCount.toDouble()
    return if (metric == StatsMetric.COST) StatsFormat.usdFigure(value) else StatsFormat.tokens(value.toLong())
}

fun trendDetail(resources: Resources, summary: StatsSummary, metric: StatsMetric, picked: StatsBuckets.Bucket?): String {
    if (picked != null) return pickedDetail(resources, metric, picked)
    val sessions = resources.sessions(summary.totals.sessions)
    val previous = summary.previousTotals
    val period = summary.range.previousPeriod(resources)
    if (previous == null || period == null) return sessions
    val (now, before) = if (metric == StatsMetric.COST) {
        summary.totals.cost.total to previous.cost.total
    } else {
        summary.totals.tokens.totalCount.toDouble() to previous.tokens.totalCount.toDouble()
    }
    val change = StatsFormat.delta(now, before)?.let {
        if (it == "0%") resources.getString(R.string.stats_change_same, period) else resources.getString(R.string.stats_change_vs, it, period)
    }
    return listOfNotNull(change, sessions).joinToString(" · ")
}

private fun pickedDetail(resources: Resources, metric: StatsMetric, picked: StatsBuckets.Bucket): String {
    val turns = resources.turns(picked.turns)
    if (picked.slices.size <= 1) return turns
    val top = picked.slices.maxByOrNull { if (metric == StatsMetric.COST) it.costUsd else it.tokens.toDouble() }
    return listOfNotNull(turns, top?.let { resources.getString(R.string.stats_most_by, it.harness.displayName()) }).joinToString(" · ")
}

fun statsFootnote(resources: Resources, summary: StatsSummary): String {
    val unpriced = summary.totals.unpricedTurns
    val note = when (summary.totals.costSource) {
        StatsCostSource.PROVIDER_REPORTED -> resources.getString(R.string.stats_note_provider)
        StatsCostSource.API_ESTIMATE, StatsCostSource.MIXED -> resources.getString(R.string.stats_note_api)
        StatsCostSource.UNPRICED -> null
    }
    return listOfNotNull(
        resources.getString(R.string.stats_note_scanning).takeIf { summary.scanState != StatsScanState.FRESH },
        note,
        resources.getQuantityString(R.plurals.stats_note_unpriced, unpriced.toInt(), "%,d".format(unpriced)).takeIf { unpriced > 0L },
    ).joinToString(" ")
}

private fun formatter(skeleton: String): DateTimeFormatter {
    val locale = Locale.getDefault()
    return DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)
}
