package com.muzammil.broski.feature.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.core.usage.LimitWindow
import com.muzammil.broski.core.usage.PlanReport
import com.muzammil.broski.core.usage.UsagePace
import com.muzammil.broski.core.usage.PlanIds
import com.muzammil.broski.core.usage.UsageSeverity
import com.muzammil.broski.design.relativeTime
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

/**
 * One plan's usage card: mark, tier and Mac, warning banner if reading failed, fullest window hero
 * figure + TickMeter + BurnChart, then remaining windows below a hairline divider.
 */
@Composable
fun PlanUsageCard(report: PlanReport, nowMs: Long, modifier: Modifier = Modifier) {
    val planTint = UsagePalette.tint(report.plan)
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 1.dp,
    ) {
        Box(
            Modifier.background(
                Brush.verticalGradient(
                    colors = listOf(planTint.copy(alpha = 0.10f), Color.Transparent),
                    endY = 260f,
                ),
            ),
        ) {
            Column(
                modifier = Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                PlanHeader(report, nowMs, planTint)
                report.problem?.let { problem ->
                    ProblemStrip(problem)
                }
                val headline = report.headline(nowMs)
                if (headline != null) {
                    HeadlineWindow(report.plan, headline, nowMs)
                    val others = report.windows
                        .filter { it.id != headline.id }
                        .sortedByDescending { it.used(nowMs) }
                    if (others.isNotEmpty()) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            others.forEach { other ->
                                LimitRow(report.plan, other, nowMs)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlanHeader(report: PlanReport, nowMs: Long, tint: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(tint.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(if (report.plan == PlanIds.CLAUDE) R.drawable.ic_agent_claude else R.drawable.ic_star),
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(22.dp),
            )
        }
        Column(Modifier.weight(1f)) {
            Text(report.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val subtitle = listOfNotNull(report.tier, report.machineName.takeIf { it.isNotBlank() }).joinToString(" · ")
            if (subtitle.isNotEmpty()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        report.readAtMs?.let { readAt ->
            Text(
                relativeTime(readAt),
                style = MaterialTheme.typography.labelSmall,
                color = if (report.isStale(nowMs)) UsagePalette.caution() else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ProblemStrip(message: String) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.7f),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun HeadlineWindow(plan: String, window: LimitWindow, nowMs: Long) {
    val pct = (window.used(nowMs) * 100.0).roundToInt()
    val eyebrow = window.shortScope?.let { "${window.span.title} · $it" }
        ?: stringResource(R.string.usage_window_limit, window.span.title)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    eyebrow.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "$pct%",
                    style = MaterialTheme.typography.displayMedium.copy(
                        fontSize = 48.sp,
                        fontWeight = FontWeight.Bold,
                        fontFeatureSettings = "tnum",
                    ),
                    color = UsagePalette.bright(plan),
                )
            }
            window.pace(nowMs)?.let { pace ->
                PaceBadge(plan, pace)
            }
        }
        TickMeter(plan, window, nowMs, height = 28.dp, showsScale = true)
        ResetLine(window, nowMs)
        if (window.trace(nowMs).size >= 8) {
            BurnChart(plan, window, nowMs)
        }
    }
}

@Composable
private fun PaceBadge(plan: String, pace: UsagePace) {
    val (label, color) = when (pace) {
        UsagePace.Under -> stringResource(R.string.usage_pace_under) to UsagePalette.tint(plan)
        UsagePace.Steady -> stringResource(R.string.usage_pace_steady) to MaterialTheme.colorScheme.onSurfaceVariant
        UsagePace.Over -> stringResource(R.string.usage_pace_over) to UsagePalette.caution()
        is UsagePace.RunsOut -> stringResource(R.string.usage_pace_runs_out, formatResetTime(pace.atMs)) to UsagePalette.caution()
    }
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = color.copy(alpha = 0.14f),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = color,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }
}

@Composable
private fun LimitRow(plan: String, window: LimitWindow, nowMs: Long) {
    val severity = window.severity(nowMs)
    val pct = (window.used(nowMs) * 100.0).roundToInt()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(window.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Text(
                "$pct%",
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
                color = if (severity == UsageSeverity.Normal) MaterialTheme.colorScheme.onSurface else UsagePalette.severityTint(plan, severity),
            )
        }
        TickMeter(plan, window, nowMs, height = 14.dp)
        ResetLine(window, nowMs, showRunsOut = true)
    }
}

@Composable
private fun ResetLine(window: LimitWindow, nowMs: Long, showRunsOut: Boolean = false) {
    val reset = window.resetsAtMs?.let { formatCountdown(it, nowMs) }
    val runsOut = if (showRunsOut) window.runsOutMs(nowMs)?.let { formatResetTime(it) } else null
    if (reset == null && runsOut == null) return
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (reset != null) {
            Text(
                stringResource(R.string.usage_resets_in, reset),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (runsOut != null) {
            Text(
                stringResource(R.string.usage_runs_out_inline, runsOut),
                style = MaterialTheme.typography.labelMedium,
                color = UsagePalette.caution(),
            )
        }
    }
}

internal fun formatCountdown(targetMs: Long, nowMs: Long): String {
    val remainingSec = ((targetMs - nowMs) / 1_000L).coerceAtLeast(0L)
    if (remainingSec < 60L) return "now"
    val days = remainingSec / 86_400L
    val hours = (remainingSec % 86_400L) / 3_600L
    val minutes = (remainingSec % 3_600L) / 60L
    return when {
        days > 0L -> "${days}d ${hours}h"
        hours > 0L -> "${hours}h ${minutes}m"
        else -> "${minutes}m"
    }
}

private val RUNS_OUT_FORMAT = DateTimeFormatter.ofPattern("EEE h:mm a")

internal fun formatResetTime(epochMs: Long): String =
    RUNS_OUT_FORMAT.format(Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()))
