package com.muzammil.broski.feature.usage

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.muzammil.broski.core.usage.StatsMetric
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import uniffi.broski_contract.StatsHarness
import uniffi.broski_contract.StatsRange
import uniffi.broski_contract.StatsTokenTotals

val ORDERED_STATS_RANGES: List<StatsRange> = listOf(
    StatsRange.DAY,
    StatsRange.WEEK,
    StatsRange.MONTH,
    StatsRange.QUARTER,
    StatsRange.YEAR,
    StatsRange.ALL,
)

fun StatsRange.shortName(): String = when (this) {
    StatsRange.DAY -> "24h"
    StatsRange.WEEK -> "7d"
    StatsRange.MONTH -> "30d"
    StatsRange.QUARTER -> "90d"
    StatsRange.YEAR -> "1y"
    StatsRange.ALL -> "All"
}

fun StatsHarness.displayName(): String = when (this) {
    StatsHarness.PI -> "Pi"
    StatsHarness.CLAUDE -> "Claude Code"
    StatsHarness.CODEX -> "Codex"
    StatsHarness.OPENCODE -> "OpenCode"
    StatsHarness.ANTIGRAVITY -> "Antigravity"
    StatsHarness.GROK -> "Grok"
    StatsHarness.GEMINI -> "Gemini CLI"
}

@Composable
fun harnessTint(harness: StatsHarness): Color {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    return when (harness) {
        StatsHarness.CLAUDE -> if (dark) Color(0xFFD97757) else Color(0xFFC15F3C)
        StatsHarness.PI -> if (dark) Color(0xFFA78BFA) else Color(0xFF7C3AED)
        StatsHarness.CODEX -> if (dark) Color(0xFF34D399) else Color(0xFF059669)
        StatsHarness.OPENCODE -> if (dark) Color(0xFF60A5FA) else Color(0xFF2563EB)
        StatsHarness.ANTIGRAVITY -> if (dark) Color(0xFF5B9DFF) else Color(0xFF1A73E8)
        StatsHarness.GROK -> if (dark) Color(0xFFFBBF24) else Color(0xFFD97706)
        StatsHarness.GEMINI -> if (dark) Color(0xFF2DD4BF) else Color(0xFF0D9488)
    }
}

val StatsTokenTotals.totalCount: Long
    get() = uncachedInput + cachedInput + cacheCreation + output

val StatsTokenTotals.promptCount: Long
    get() = uncachedInput + cachedInput + cacheCreation

val StatsTokenTotals.cacheHitRate: Double?
    get() = if (promptCount > 0L) cachedInput.toDouble() / promptCount.toDouble() else null

object StatsFormat {
    fun usd(value: Double): String {
        val a = abs(value)
        return when {
            a >= 1_000_000.0 -> String.format(Locale.US, "$%.2fM", value / 1_000_000.0)
            a >= 10_000.0 -> String.format(Locale.US, "$%.1fK", value / 1_000.0)
            a >= 100.0 -> String.format(Locale.US, "$%,d", value.roundToLong())
            a >= 1.0 -> String.format(Locale.US, "$%.2f", value)
            a == 0.0 -> "$0.00"
            a >= 0.01 -> String.format(Locale.US, "$%.2f", value)
            else -> String.format(Locale.US, "$%.3f", value)
        }
    }

    fun tokens(count: Long): String {
        val a = abs(count.toDouble())
        if (a < 1_000.0) return count.toString()
        val units = listOf(
            1_000_000_000_000.0 to "T",
            1_000_000_000.0 to "B",
            1_000_000.0 to "M",
            1_000.0 to "K",
        )
        for ((scale, suffix) in units) {
            if (a >= scale) {
                val scaled = count.toDouble() / scale
                return if (scaled >= 100.0) {
                    "${scaled.roundToLong()}$suffix"
                } else {
                    String.format(Locale.US, "%.1f%s", scaled, suffix)
                }
            }
        }
        return count.toString()
    }

    fun percent(ratio: Double): String {
        if (!ratio.isFinite()) return "—"
        val pct = ratio * 100.0
        if (pct > 0.0 && pct < 0.1) return "<0.1%"
        return if (pct >= 10.0) "${pct.roundToInt()}%" else String.format(Locale.US, "%.1f%%", pct)
    }

    fun delta(current: Double, previous: Double?): String? {
        if (previous == null || previous <= 0.0) return null
        val pct = ((current - previous) / previous) * 100.0
        val rounded = pct.roundToInt()
        if (rounded == 0) return "0%"
        val clamped = min(999, abs(rounded))
        val sign = if (rounded > 0) "+" else "-"
        return if (abs(rounded) > 999) "${sign}999%+" else "$sign$clamped%"
    }

    /** The headline figure, whole dollars once there are a hundred: "$10,742", "$84.20". */
    fun usdFigure(value: Double): String {
        val format = NumberFormat.getCurrencyInstance(Locale.getDefault())
        format.currency = Currency.getInstance("USD")
        val digits = if (value >= 100.0) 0 else 2
        format.minimumFractionDigits = digits
        format.maximumFractionDigits = digits
        return format.format(value)
    }

    /** A figure as short as it reads: "$358", "$1.2K", "1.6B". */
    fun compact(value: Double, metric: StatsMetric): String =
        if (metric == StatsMetric.COST) usd(value) else tokens(value.toLong())
}
