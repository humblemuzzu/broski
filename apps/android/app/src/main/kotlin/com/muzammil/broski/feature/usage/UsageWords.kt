package com.muzammil.broski.feature.usage

import android.content.res.Resources
import android.text.format.DateFormat
import com.muzammil.broski.R
import com.muzammil.broski.core.usage.LimitWindow
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** Left, 0 to 1. */
fun LimitWindow.left(nowMs: Long): Double = 1.0 - used(nowMs)

/** "83%". */
fun LimitWindow.leftPercent(nowMs: Long): String = "${(left(nowMs) * 100).roundToInt()}%"

/** "Runs out Thu 12 PM" when the limit will run out before it resets at its rate so far; else null. */
fun LimitWindow.runsOutWords(resources: Resources, nowMs: Long): String? =
    runsOutMs(nowMs)?.let { resources.getString(R.string.usage_runs_out, moment(it, nowMs)) }

/**
 * "Resets 9:47 PM" today, "Resets Sun 2:30 AM" beyond: a time, not a countdown, so a widget never
 * shows one gone stale.
 */
fun LimitWindow.resetWords(resources: Resources, nowMs: Long): String {
    val reset = resetsAtMs
    if (reset == null || reset <= nowMs) {
        return resources.getString(if (used(nowMs) == 0.0) R.string.usage_not_started else R.string.usage_started_over)
    }
    return resources.getString(R.string.usage_resets_at, moment(reset, nowMs))
}

/** The time alone today, the weekday and time beyond, in the phone's 12- or 24-hour clock. */
private fun moment(atMs: Long, nowMs: Long): String {
    val zone = ZoneId.systemDefault()
    val at = Instant.ofEpochMilli(atMs).atZone(zone)
    val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate() == at.toLocalDate()
    val locale = Locale.getDefault()
    val pattern = DateFormat.getBestDateTimePattern(locale, if (today) "jmm" else "EEEjmm")
    return DateTimeFormatter.ofPattern(pattern, locale).format(at)
}
