package com.muzammil.broski.design.orb

import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.animationsEnabled

/** Which ink the orb draws: [AUTO] follows the app's colour scheme. */
enum class OrbTheme { AUTO, DARK, LIGHT }

/**
 * A thinking orb: dotted 3D geometry drawn on a Canvas, one of two tuned designs ([size]) shown at
 * [displaySize]. The geometry is scaled inside the canvas, so it stays crisp at any factor.
 *
 * Every orb reads the frame time of the one Compose frame clock, so several on screen stay in
 * phase. It draws only while composed and not [paused]; paused, or with animations turned off in
 * the system settings, it rests on one still frame.
 */
@Composable
fun ThinkingOrb(
    modifier: Modifier = Modifier,
    state: OrbState = OrbState.WORKING,
    size: OrbSize = OrbSize.PX64,
    theme: OrbTheme = OrbTheme.AUTO,
    speed: Double = 1.0,
    paused: Boolean = false,
    displaySize: Dp = size.px.dp,
) {
    val preset = remember(state, size) { resolvePreset(state, size) }
    val frame = remember { OrbFrame() }
    val still = paused || !animationsEnabled()
    val dark = when (theme) {
        OrbTheme.DARK -> true
        OrbTheme.LIGHT -> false
        OrbTheme.AUTO -> MaterialTheme.colorScheme.background.luminance() < 0.5f
    }
    var frameNanos by remember { mutableLongStateOf(System.nanoTime()) }
    LaunchedEffect(still) {
        if (!still) {
            while (true) withInfiniteAnimationFrameNanos { frameNanos = it }
        }
    }
    val effectiveSpeed = preset.speed * speed
    val designSize = size.px.toDouble()
    Canvas(
        modifier
            .size(displaySize)
            .graphicsLayer()
            .semantics {
                contentDescription = state.label
                role = Role.Image
            },
    ) {
        val t = if (still) OrbSpec.REDUCED_MOTION_T * effectiveSpeed else frameNanos / 1e9 * effectiveSpeed
        orbFrame(preset, designSize, t, frame)
        drawOrb(frame, this.size.width / designSize.toFloat(), dark)
    }
}

private fun ink(white: Double, alpha: Double, dark: Boolean): Color {
    val g = inkGrey(white, dark) / 255f
    return Color(g, g, g, alpha.toFloat())
}

private fun DrawScope.drawOrb(frame: OrbFrame, zoom: Float, dark: Boolean) {
    // lines first, so nodes sit on top of their edges
    for (i in 0 until frame.lineCount) {
        drawLine(
            color = ink(frame.lineWhite(i), frame.lineA(i), dark),
            start = Offset(frame.lineX1(i).toFloat() * zoom, frame.lineY1(i).toFloat() * zoom),
            end = Offset(frame.lineX2(i).toFloat() * zoom, frame.lineY2(i).toFloat() * zoom),
            strokeWidth = frame.lineW(i).toFloat() * zoom,
        )
    }
    // dots are already z-sorted into draw order by the engine
    for (i in 0 until frame.dotCount) {
        drawCircle(
            color = ink(frame.white(i), frame.a(i), dark),
            radius = frame.r(i).toFloat() * zoom,
            center = Offset(frame.x(i).toFloat() * zoom, frame.y(i).toFloat() * zoom),
        )
    }
}
