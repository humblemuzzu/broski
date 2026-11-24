package com.muzammil.broski.feature.chat.composer

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

private val TrackHeight = 56.dp
private val Lead = 44.dp
private val Trail = 22.dp

/** The handle follows the finger this closely: stiff enough to feel held, soft enough not to jitter. */
private val follow = spring<Float>(dampingRatio = 1f, stiffness = 1500f)

/**
 * A thinking level on a thick track, lowest at the start. The fill runs to the handle, a short bar
 * inside the fill's end; a touch anywhere takes the handle there, a drag carries it, and on release it
 * springs onto the nearest level. Each level the handle crosses ticks and is reported to [onIndex] as
 * it is crossed, so the title above can follow; [onCommit] gets the level it comes to rest on. With
 * [index] `null` no level is set yet, and the track shows no fill until one is touched.
 */
@Composable
fun ThinkingSlider(
    count: Int,
    index: Int?,
    label: String,
    value: String,
    onIndex: (Int) -> Unit,
    onCommit: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val settle = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
    val trackColor = Grouped.card
    val fillColor = MaterialTheme.colorScheme.onSurface
    val dotColor = MaterialTheme.colorScheme.onSurfaceVariant
    var reported by remember { mutableIntStateOf(index ?: -1) }
    val report by rememberUpdatedState(onIndex)
    val commit by rememberUpdatedState(onCommit)
    var held by remember { mutableStateOf(false) }
    val press by animateFloatAsState(if (held) 1f else 0f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "handle")

    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .height(TrackHeight)
            .semantics {
                contentDescription = label
                stateDescription = value
                progressBarRangeInfo = ProgressBarRangeInfo((index ?: 0).toFloat(), 0f..(count - 1).toFloat(), (count - 2).coerceAtLeast(0))
                setProgress { target ->
                    val level = target.roundToInt().coerceIn(0, count - 1)
                    report(level)
                    commit(level)
                    true
                }
            },
    ) {
        val track = with(density) { LevelTrack(count, constraints.maxWidth.toFloat(), Lead.toPx(), Trail.toPx()) }
        val handle = remember { Animatable(Float.NaN) }

        LaunchedEffect(index, track.width) {
            val level = index ?: return@LaunchedEffect
            if (held) return@LaunchedEffect
            reported = level
            if (handle.value.isNaN()) handle.snapTo(track.x(level)) else handle.animateTo(track.x(level), settle)
        }

        fun reach(x: Float) {
            val level = track.nearest(x)
            if (level != reported) {
                reported = level
                haptics.perform(Haptic.PickerStep)
                report(level)
            }
        }

        fun follow(x: Float) {
            val target = track.clamp(x)
            scope.launch {
                if (handle.value.isNaN()) handle.snapTo(target) else handle.animateTo(target, follow)
            }
            reach(target)
        }

        fun release(x: Float) {
            val level = track.nearest(x)
            held = false
            reach(track.x(level))
            scope.launch {
                if (handle.value.isNaN()) handle.snapTo(track.clamp(x))
                handle.animateTo(track.x(level), settle)
            }
            commit(level)
        }

        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(track.width, count) {
                    var last = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { start ->
                            held = true
                            last = start.x
                            follow(start.x)
                        },
                        onDragEnd = { release(last) },
                        onDragCancel = { release(last) },
                    ) { change, _ ->
                        change.consume()
                        last = change.position.x
                        follow(last)
                    }
                }
                .pointerInput(track.width, count) {
                    detectTapGestures { tap -> release(tap.x) }
                },
        ) {
            drawLevels(track, handle.value, press, SliderColors(trackColor, fillColor, dotColor))
        }
    }
}

private class SliderColors(val track: Color, val fill: Color, val dot: Color)

/** The track, the fill to `x` (none while `x` is NaN), a dot per level and the handle, taller as `press` nears 1. */
private fun DrawScope.drawLevels(track: LevelTrack, x: Float, press: Float, colors: SliderColors) {
    val radius = CornerRadius(size.height / 2f)
    drawRoundRect(colors.track, cornerRadius = radius)
    val placed = !x.isNaN()
    if (placed) {
        drawRoundRect(colors.fill, size = Size((x + track.trail).coerceIn(size.height, size.width), size.height), cornerRadius = radius)
    }
    val dot = 2.5.dp.toPx()
    val clear = 8.dp.toPx()
    for (level in 0 until track.count) {
        val at = track.x(level)
        if (placed && abs(at - x) < clear) continue
        val color = if (placed && at < x) colors.track.copy(alpha = 0.6f) else colors.dot.copy(alpha = 0.55f)
        drawCircle(color, dot, Offset(at, size.height / 2f))
    }
    if (!placed) return
    val width = (3f - press).dp.toPx()
    val height = (22f + 8f * press).dp.toPx()
    drawRoundRect(
        colors.track,
        topLeft = Offset(x - width / 2f, (size.height - height) / 2f),
        size = Size(width, height),
        cornerRadius = CornerRadius(width / 2f),
    )
}
