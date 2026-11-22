package com.muzammil.broski.feature.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.usage.LimitWindow
import com.muzammil.broski.core.usage.PlanIds
import com.muzammil.broski.core.usage.UsageSeverity

/** Brand colours matching iOS `UsageStyle.swift`; a plan without its own is drawn in the theme's primary. */
internal object UsagePalette {
    @Composable
    fun isDark(): Boolean = MaterialTheme.colorScheme.surface.luminance() < 0.5f

    @Composable
    fun tint(plan: String): Color {
        val dark = isDark()
        return when (plan) {
            PlanIds.CLAUDE -> if (dark) Color(0xFFD97757) else Color(0xFFC15F3C)
            PlanIds.ANTIGRAVITY -> if (dark) Color(0xFF5B9DFF) else Color(0xFF1A73E8)
            else -> MaterialTheme.colorScheme.primary
        }
    }

    @Composable
    fun bright(plan: String): Color {
        val dark = isDark()
        return when (plan) {
            PlanIds.CLAUDE -> if (dark) Color(0xFFFF9B73) else Color(0xFFC2522D)
            PlanIds.ANTIGRAVITY -> if (dark) Color(0xFF8AB4FF) else Color(0xFF2F5BEA)
            else -> MaterialTheme.colorScheme.primary
        }
    }

    @Composable
    fun caution(): Color = if (isDark()) Color(0xFFFF9F0A) else Color(0xFFC2410C)

    @Composable
    fun critical(): Color = if (isDark()) Color(0xFFFF453A) else Color(0xFFD70015)

    @Composable
    fun severityTint(plan: String, severity: UsageSeverity): Color = when (severity) {
        UsageSeverity.Normal -> tint(plan)
        UsageSeverity.High -> caution()
        UsageSeverity.Critical -> critical()
    }

    @Composable
    fun meterColors(plan: String, severity: UsageSeverity): List<Color> {
        val dark = isDark()
        val base = when (plan) {
            PlanIds.CLAUDE -> if (dark) {
                listOf(Color(0xFFFFC2A3), Color(0xFFFF8A5C), Color(0xFFF2603D))
            } else {
                listOf(Color(0xFFF0A27E), Color(0xFFD9663F), Color(0xFFC2452D))
            }
            PlanIds.ANTIGRAVITY -> if (dark) {
                listOf(Color(0xFF9CC4FF), Color(0xFF4D8BFF), Color(0xFF8C6CFF))
            } else {
                listOf(Color(0xFF5B9DFF), Color(0xFF2F6BFF), Color(0xFF6B4BEA))
            }
            else -> MaterialTheme.colorScheme.let { listOf(it.primary.copy(alpha = 0.55f), it.primary, it.tertiary) }
        }
        return when (severity) {
            UsageSeverity.Normal -> base
            UsageSeverity.High -> listOf(base[0], caution())
            UsageSeverity.Critical -> listOf(base[0], caution(), critical())
        }
    }
}

/**
 * Horizontal usage meter with gradient fill and an even-pace vertical tick mark showing where an
 * even spread through the window would sit.
 */
@Composable
fun TickMeter(
    plan: String,
    window: LimitWindow,
    nowMs: Long,
    height: Dp,
    showsScale: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val used = window.used(nowMs).toFloat()
    val elapsed = window.elapsed(nowMs)?.toFloat()
    val severity = window.severity(nowMs)
    val fillColors = UsagePalette.meterColors(plan, severity)
    val trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    val tickColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Canvas(Modifier.fillMaxWidth().height(height)) {
            val radius = size.height / 2f
            drawRoundRect(
                color = trackColor,
                size = size,
                cornerRadius = CornerRadius(radius, radius),
            )
            val fillWidth = (size.width * used).coerceAtLeast(if (used > 0f) size.height * 0.5f else 0f)
            if (fillWidth > 0f) {
                drawRoundRect(
                    brush = Brush.horizontalGradient(fillColors, startX = 0f, endX = fillWidth.coerceAtLeast(1f)),
                    size = Size(fillWidth.coerceAtMost(size.width), size.height),
                    cornerRadius = CornerRadius(radius, radius),
                )
            }
            if (elapsed != null && elapsed in 0.02f..0.98f) {
                val x = size.width * elapsed
                drawLine(
                    color = tickColor,
                    start = Offset(x, 2.dp.toPx()),
                    end = Offset(x, size.height - 2.dp.toPx()),
                    strokeWidth = 2.dp.toPx(),
                    cap = StrokeCap.Round,
                )
            }
        }
        if (showsScale) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("0%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("50%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("100%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * Window burn chart: recorded usage curve over time, an even-pace reference diagonal, and a dashed
 * projection when current pace is measurable.
 */
@Composable
fun BurnChart(
    plan: String,
    window: LimitWindow,
    nowMs: Long,
    modifier: Modifier = Modifier,
) {
    val startMs = window.startMs ?: return
    val resetsAtMs = window.resetsAtMs ?: return
    val spanMs = (resetsAtMs - startMs).coerceAtLeast(1L).toDouble()
    val trace = window.trace(nowMs)
    if (trace.size < 2) return

    val severity = window.severity(nowMs)
    val lineColor = UsagePalette.severityTint(plan, severity)
    val gridColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    val evenColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f)
    val projectionColor = lineColor.copy(alpha = 0.65f)
    val runsOutMs = window.runsOutMs(nowMs)
    val hasPace = window.pace(nowMs) != null

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(Modifier.fillMaxWidth().height(140.dp)) {
            val padTop = 6.dp.toPx()
            val padBottom = 6.dp.toPx()
            val plotHeight = (size.height - padTop - padBottom).coerceAtLeast(1f)
            fun xOf(ms: Long): Float = (((ms - startMs).toDouble() / spanMs).coerceIn(0.0, 1.0) * size.width).toFloat()
            fun yOf(pct: Double): Float = padTop + plotHeight * (1f - (pct / 100.0).coerceIn(0.0, 1.0).toFloat())

            // Horizontal 0%, 50%, 100% guides.
            for (pct in listOf(0.0, 50.0, 100.0)) {
                val y = yOf(pct)
                drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
            }

            // Even pace diagonal: (start, 0%) -> (reset, 100%).
            drawLine(
                color = evenColor,
                start = Offset(0f, yOf(0.0)),
                end = Offset(size.width, yOf(100.0)),
                strokeWidth = 1.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())),
            )

            // Usage area + curve.
            val strokePath = Path()
            val fillPath = Path()
            trace.forEachIndexed { index, point ->
                val x = xOf(point.atMs)
                val y = yOf(point.usedPercent)
                if (index == 0) {
                    strokePath.moveTo(x, y)
                    fillPath.moveTo(x, yOf(0.0))
                    fillPath.lineTo(x, y)
                } else {
                    strokePath.lineTo(x, y)
                    fillPath.lineTo(x, y)
                }
            }
            val last = trace.last()
            val lastX = xOf(last.atMs)
            val lastY = yOf(last.usedPercent)
            fillPath.lineTo(lastX, yOf(0.0))
            fillPath.close()

            drawPath(
                path = fillPath,
                brush = Brush.verticalGradient(
                    colors = listOf(lineColor.copy(alpha = 0.24f), lineColor.copy(alpha = 0.0f)),
                    startY = padTop,
                    endY = size.height - padBottom,
                ),
            )
            drawPath(
                path = strokePath,
                color = lineColor,
                style = Stroke(width = 2.25.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
            )

            // Dashed pace projection from the latest reading to either 100% exhaustion or reset.
            if (hasPace) {
                val targetX: Float
                val targetY: Float
                if (runsOutMs != null) {
                    targetX = xOf(runsOutMs)
                    targetY = yOf(100.0)
                } else {
                    val elapsed = window.elapsed(nowMs) ?: 1.0
                    val projectedPct = (window.used(nowMs) / elapsed * 100.0).coerceIn(0.0, 100.0)
                    targetX = size.width
                    targetY = yOf(projectedPct)
                }
                drawLine(
                    color = projectionColor,
                    start = Offset(lastX, lastY),
                    end = Offset(targetX, targetY),
                    strokeWidth = 1.5.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx())),
                )
            }
        }
        ChartLegend(lineColor, evenColor, showPace = hasPace)
    }
}

@Composable
private fun ChartLegend(lineColor: Color, evenColor: Color, showPace: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        LegendKey(stringResource(R.string.usage_legend_used), lineColor, dashed = false)
        LegendKey(stringResource(R.string.usage_legend_even_pace), evenColor, dashed = true)
        if (showPace) {
            LegendKey(stringResource(R.string.usage_legend_at_pace), lineColor.copy(alpha = 0.7f), dashed = true)
        }
    }
}

@Composable
private fun LegendKey(label: String, color: Color, dashed: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.width(14.dp).height(6.dp)) {
            drawLine(
                color = color,
                start = Offset(0f, size.height / 2f),
                end = Offset(size.width, size.height / 2f),
                strokeWidth = (if (dashed) 1.5 else 2.25).dp.toPx(),
                cap = StrokeCap.Round,
                pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.5.dp.toPx())) else null,
            )
        }
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
