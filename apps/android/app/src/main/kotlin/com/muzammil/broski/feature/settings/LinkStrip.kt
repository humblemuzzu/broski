package com.muzammil.broski.feature.settings

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.BroskiTheme
import kotlin.math.max
import kotlin.math.sqrt

/** One round trip to a Mac's bridge: [ms] is null when it did not come back in time. */
data class Beat(val id: Int, val ms: Double?)

private val Bar = 3.dp
private val Gap = 3.dp
private const val SPREAD_MS = 25.0
private val Smooth = CubicBezierEasing(0.2f, 0.0f, 0.0f, 1.0f)

/**
 * The beats as a wave of capsules about a centre line, newest at the right, older ones fading out.
 * Each reaches between a fifth and all of the height by where its round trip falls between the
 * quickest and the slowest shown, over a spread of at least [SPREAD_MS], on a square-root curve: a
 * steady link breathes gently and keeps breathing beside a slow trip, which stands out. Slots not
 * yet measured are a flat line of dots; a missed beat is a caution dot. Not live, the wave rests dimmed.
 */
@Composable
fun LinkStrip(beats: List<Beat>, isLive: Boolean, modifier: Modifier = Modifier) {
    val ink = MaterialTheme.colorScheme.onSurface
    val caution = BroskiTheme.semantic.caution
    val slide = remember { Animatable(1f) }
    val newest = beats.lastOrNull()?.id
    LaunchedEffect(newest) {
        if (newest == null) return@LaunchedEffect
        slide.snapTo(0f)
        slide.animateTo(1f, tween(450, easing = Smooth))
    }
    Box(modifier.alpha(if (isLive) 1f else 0.4f).clearAndSetSemantics {}) {
        Canvas(Modifier.fillMaxSize()) {
            val step = (Bar + Gap).toPx()
            val slots = max(1, ((size.width + Gap.toPx()) / step).toInt())
            val shown = beats.takeLast(slots)
            val trips = shown.mapNotNull { it.ms }
            val low = trips.minOrNull() ?: 0.0
            val high = max(trips.maxOrNull() ?: 0.0, low + SPREAD_MS)
            val shift = (1f - slide.value) * step
            for (slot in 0 until slots - shown.size) drawDot(ink.copy(alpha = 0.12f), slot * step + shift)
            shown.forEachIndexed { index, beat ->
                val slot = slots - shown.size + index
                val age = (shown.size - 1 - index).toFloat() / slots
                val isNewest = index == shown.lastIndex
                val x = slot * step + if (isNewest) 0f else shift
                val grow = if (isNewest) 0.1f + 0.9f * slide.value else 1f
                val fade = if (isNewest) slide.value else 1f
                val ms = beat.ms
                if (ms == null) {
                    drawDot(caution.copy(alpha = (0.95f - 0.6f * age) * fade), x, grow)
                } else {
                    val reach = 0.2 + 0.8 * sqrt((ms - low) / (high - low))
                    drawCapsule(ink.copy(alpha = (0.95f - 0.75f * age) * fade), x, size.height * reach.toFloat() * grow)
                }
            }
        }
    }
}

private fun DrawScope.drawCapsule(color: Color, x: Float, height: Float) {
    val width = Bar.toPx()
    drawRoundRect(color, Offset(x, (size.height - height) / 2), Size(width, height), CornerRadius(width / 2))
}

private fun DrawScope.drawDot(color: Color, x: Float, scale: Float = 1f) = drawCapsule(color, x, Bar.toPx() * scale)
