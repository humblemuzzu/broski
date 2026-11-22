package com.muzammil.broski.feature.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.muzammil.broski.core.usage.StatsMetric
import uniffi.broski_contract.StatsHarness
import uniffi.broski_contract.StatsResolution
import uniffi.broski_contract.StatsSeriesPoint

data class ShareSegment(
    val caption: String,
    val value: Double,
    val tint: Color,
)

@Composable
fun StatsActivityChartCard(
    series: List<StatsSeriesPoint>,
    resolution: StatsResolution,
    metric: StatsMetric,
    modifier: Modifier = Modifier,
) {
    val heading = when {
        resolution == StatsResolution.HOUR && metric == StatsMetric.COST -> "Hourly cost"
        resolution == StatsResolution.HOUR && metric == StatsMetric.TOKENS -> "Hourly tokens"
        metric == StatsMetric.COST -> "Daily cost"
        else -> "Daily tokens"
    }
    val hasData = series.any { if (metric == StatsMetric.COST) it.costUsd > 0.0 else it.totalTokens > 0L }
    val harnessColors = StatsHarness.entries.associateWith { harnessTint(it) }
    val gridColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant

    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(heading, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(14.dp))
            if (!hasData || series.isEmpty()) {
                Text(
                    "No activity in this window.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = secondary,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 28.dp),
                    textAlign = TextAlign.Center,
                )
            } else {
                val maxVal = series.maxOf { if (metric == StatsMetric.COST) it.costUsd else it.totalTokens.toDouble() }.coerceAtLeast(1e-9)
                val peakText = if (metric == StatsMetric.COST) StatsFormat.usd(maxVal) else StatsFormat.tokens(maxVal.toLong())
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Text(
                        peakText,
                        style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
                        color = secondary,
                    )
                }
                Spacer(Modifier.height(6.dp))
                Canvas(Modifier.fillMaxWidth().height(132.dp)) {
                    val w = size.width
                    val h = size.height
                    for (i in 0..2) {
                        val y = h * (i / 2f)
                        drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1.dp.toPx())
                    }
                    val count = series.size
                    val slotW = w / count
                    val gap = (slotW * 0.22f).coerceIn(1f, 6f)
                    val barW = (slotW - gap).coerceAtLeast(2f)
                    val radius = CornerRadius(3.dp.toPx(), 3.dp.toPx())

                    series.forEachIndexed { idx, pt ->
                        var topY = h
                        val leftX = idx * slotW + gap / 2f
                        for (slice in pt.byHarness) {
                            val raw = if (metric == StatsMetric.COST) slice.costUsd else slice.totalTokens.toDouble()
                            if (raw <= 0.0) continue
                            val segH = ((raw / maxVal) * h).toFloat().coerceAtLeast(2f)
                            topY = (topY - segH).coerceAtLeast(0f)
                            val color = harnessColors[slice.harness] ?: Color(0xFF60A5FA)
                            drawRoundRect(
                                color = color,
                                topLeft = Offset(leftX, topY),
                                size = Size(barW, segH),
                                cornerRadius = radius,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                val firstAxis = series.first().label
                val midAxis = series[series.size / 2].label
                val lastAxis = series.last().label
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(firstAxis, style = MaterialTheme.typography.labelSmall, color = secondary)
                    if (series.size > 2) {
                        Text(midAxis, style = MaterialTheme.typography.labelSmall, color = secondary)
                    }
                    Text(lastAxis, style = MaterialTheme.typography.labelSmall, color = secondary)
                }
            }
        }
    }
}

@Composable
fun StatsShareBarCard(
    heading: String,
    aside: String?,
    segments: List<ShareSegment>,
    formatValue: (Double) -> String,
    modifier: Modifier = Modifier,
) {
    val total = segments.sumOf { it.value.coerceAtLeast(0.0) }
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant

    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(heading, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (aside != null) {
                    Text(aside, style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"), color = secondary)
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().height(10.dp).clip(CircleShape),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                for (seg in segments) {
                    if (seg.value <= 0.0 || total <= 0.0) continue
                    val weight = (seg.value / total).toFloat().coerceAtLeast(0.02f)
                    Box(Modifier.weight(weight).height(10.dp).background(seg.tint))
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (seg in segments) {
                    val ratio = if (total > 0.0) seg.value / total else 0.0
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).background(seg.tint, CircleShape))
                        Spacer(Modifier.width(8.dp))
                        Text(seg.caption, style = MaterialTheme.typography.bodySmall, color = secondary, modifier = Modifier.weight(1f))
                        Text(
                            formatValue(seg.value),
                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            StatsFormat.percent(ratio),
                            style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
                            color = secondary,
                            modifier = Modifier.width(40.dp),
                            textAlign = TextAlign.End,
                        )
                    }
                }
            }
        }
    }
}
