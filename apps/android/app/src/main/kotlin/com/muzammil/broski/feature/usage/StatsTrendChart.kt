package com.muzammil.broski.feature.usage

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.usage.StatsBuckets
import com.muzammil.broski.core.usage.StatsMetric
import java.time.ZonedDateTime
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val ChartHeight = 168.dp
private const val WIDEST_DP = 14
private const val FILL = 0.56f
private const val HOLD_MS = 100L

/**
 * The period as one capsule per hour, day or week: a faint track the height of the busiest, filled
 * from the bottom in ink as the Limits bars fill, and a dotted line at the average. Under it, its
 * first and last moments at its edges and what the average comes to between them. A finger reads one
 * bar ([picked], by index); the rest step back.
 */
@Composable
fun StatsTrendChart(
    buckets: StatsBuckets,
    metric: StatsMetric,
    picked: Int?,
    onTouch: (Int?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val resources = LocalResources.current
    val list = buckets.buckets
    val peak = list.maxOfOrNull { it.value(metric) } ?: 0.0
    val average = if (list.isEmpty()) 0.0 else list.sumOf { it.value(metric) } / list.size
    val averageText = StatsFormat.compact(average, metric)
    val perBucket = buckets.unit.perBucket(resources)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.fillMaxWidth().height(ChartHeight).semantics {
                if (average > 0.0) contentDescription = resources.getString(R.string.stats_chart_average, averageText, perBucket)
            },
            contentAlignment = Alignment.Center,
        ) {
            Bars(list, metric, peak, average, picked, onTouch)
            if (peak == 0.0) {
                Text(
                    resources.getString(R.string.stats_chart_empty),
                    style = IosText.footnote,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Edges(buckets, averageText.takeIf { average > 0.0 }?.let { resources.getString(R.string.stats_chart_average, it, perBucket) })
    }
}

@Composable
private fun Bars(list: List<StatsBuckets.Bucket>, metric: StatsMetric, peak: Double, average: Double, picked: Int?, onTouch: (Int?) -> Unit) {
    val ink = MaterialTheme.colorScheme.onSurface
    val dim by animateFloatAsState(if (picked != null) DIMMED else 1f, tween(200), label = "dim")
    Canvas(Modifier.fillMaxSize().bucketTouch(list.size, onTouch)) {
        val top = if (peak > 0.0) peak else 1.0
        val slotDp = size.width / density / max(1, list.size)
        val barWidth = max(2, min(WIDEST_DP, (slotDp * FILL).roundToInt())).dp.toPx()
        val slot = size.width / max(1, list.size)
        list.forEachIndexed { index, bucket ->
            val x = index * slot + (slot - barWidth) / 2
            drawRoundRect(ink.copy(alpha = 0.06f), Offset(x, 0f), Size(barWidth, size.height), CornerRadius(barWidth / 2))
            val value = bucket.value(metric)
            if (value > 0.0) {
                val height = (max(value, top * 0.015) / top * size.height).toFloat()
                val alpha = if (picked != null && picked != index) dim else 1f
                val brush = Brush.verticalGradient(
                    listOf(ink.copy(alpha = 0.92f), ink.copy(alpha = 0.5f)),
                    startY = size.height - height,
                    endY = size.height,
                )
                drawRoundRect(brush, Offset(x, size.height - height), Size(barWidth, height), CornerRadius(barWidth / 2), alpha = alpha)
            }
        }
        if (average > 0.0) {
            val y = (size.height - average / top * size.height).toFloat()
            drawAverage(ink.copy(alpha = 0.45f), Offset(0f, y), Offset(size.width, y))
        }
    }
}

private fun DrawScope.drawAverage(color: Color, from: Offset, to: Offset) {
    drawLine(
        color, from, to,
        strokeWidth = 1.dp.toPx(),
        cap = StrokeCap.Round,
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(0.5.dp.toPx(), 4.dp.toPx())),
    )
}

@Composable
private fun Edges(buckets: StatsBuckets, average: String?) {
    val resources = LocalResources.current
    val now = ZonedDateTime.now()
    val list = buckets.buckets
    val ink = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        val secondary = MaterialTheme.colorScheme.onSurfaceVariant
        list.firstOrNull()?.let { Text(buckets.edgeLabel(resources, it, false, now), style = IosText.caption, color = secondary, maxLines = 1) }
        if (average != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Canvas(Modifier.width(14.dp).height(1.dp)) { drawAverage(ink, Offset(0f, size.height / 2), Offset(size.width, size.height / 2)) }
                Text(average, style = IosText.caption.merge(IosText.tabular), color = secondary, maxLines = 1)
            }
        }
        list.lastOrNull()?.let { Text(buckets.edgeLabel(resources, it, true, now), style = IosText.caption, color = secondary, maxLines = 1) }
    }
}

private const val DIMMED = 0.28f

/**
 * Reads the bar under a finger: a tap, a short hold or a sideways drag starts it, a drag the list
 * takes for scrolling does not, and it lets go with the finger.
 */
private fun Modifier.bucketTouch(count: Int, onTouch: (Int?) -> Unit): Modifier = pointerInput(count) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        val slop = viewConfiguration.touchSlop
        var lastX = down.position.x
        val engaged = withTimeoutOrNull(HOLD_MS) {
            var verdict: Boolean? = null
            while (verdict == null) {
                val change = awaitPointerEvent(PointerEventPass.Final).changes.firstOrNull { it.id == down.id }
                if (change != null) lastX = change.position.x
                verdict = when {
                    change == null || change.isConsumed -> false
                    !change.pressed || abs(change.position.x - down.position.x) > slop -> true
                    else -> null
                }
            }
            verdict
        } ?: true
        if (!engaged || count == 0) return@awaitEachGesture
        fun index(x: Float) = (x / size.width * count).toInt().coerceIn(0, count - 1)
        onTouch(index(lastX))
        do {
            val change = awaitPointerEvent(PointerEventPass.Final).changes.firstOrNull { it.id == down.id } ?: break
            if (change.isConsumed) break
            if (change.pressed) onTouch(index(change.position.x))
        } while (change.pressed)
        onTouch(null)
    }
}
