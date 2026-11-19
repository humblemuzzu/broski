package com.muzammil.broski.design.beam

import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle

/**
 * The animated beam of light riding the element's rounded border while [active]: Android's port of the
 * MIT-licensed Border Beam (the rotate family, as BorderBeamKit draws it on iOS). It is drawn over the
 * content, takes no touches and changes no layout; the bloom may spill past the element's shape.
 *
 * [cornerRadius] is the element's own corner, so the beam hugs it. The beam fades in over 0.6 s and out
 * over 0.5 s, and once it has faded out it draws nothing and ticks no frames; frames also stop while the
 * lifecycle is not resumed. It needs Android 13 (AGSL): below that, or when the shader does not compile,
 * this modifier does nothing.
 */
fun Modifier.borderBeam(
    active: Boolean,
    cornerRadius: Dp,
    size: BeamSize = BeamSize.MD,
    colorVariant: BeamColorVariant = BeamColorVariant.COLORFUL,
    theme: BeamTheme = BeamTheme.AUTO,
    strength: Float = 1f,
): Modifier = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
    this
} else {
    shaderBeam(active, cornerRadius, size, colorVariant, theme, strength)
}

/** The fade and the time the beam is drawn at; [seconds] is read only while drawing, so a frame redraws and nothing recomposes. */
private class BeamClock(val fader: BeamFader) {
    var seconds by mutableDoubleStateOf(0.0)
        private set

    /**
     * Ticks a frame at a time while the beam is shown or fading out and [lifecycle] is resumed, then
     * stops. A fade is a finite animation; only the shown beam's endless travel is an infinite one,
     * which an [androidx.compose.ui.platform.InfiniteAnimationPolicy] (a UI test's) may stop on a
     * fully shown frame.
     */
    suspend fun run(active: Boolean, lifecycle: Lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            if (!active && fader.isHidden(seconds)) return@repeatOnLifecycle
            withFrameNanos { nanos ->
                seconds = nanos / NANOS_PER_SECOND
                fader.retarget(active, seconds)
            }
            while (active || !fader.isHidden(seconds)) {
                if (fader.isFading(seconds)) {
                    withFrameNanos { nanos -> seconds = nanos / NANOS_PER_SECOND }
                } else {
                    withInfiniteAnimationFrameNanos { nanos -> seconds = nanos / NANOS_PER_SECOND }
                }
            }
        }
    }

    private companion object {
        const val NANOS_PER_SECOND = 1_000_000_000.0
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun Modifier.shaderBeam(
    active: Boolean,
    cornerRadius: Dp,
    size: BeamSize,
    colorVariant: BeamColorVariant,
    theme: BeamTheme,
    strength: Float,
): Modifier = composed {
    val spec = BeamSpecStore.spec(LocalContext.current) ?: return@composed this
    val dark = when (theme) {
        BeamTheme.AUTO -> MaterialTheme.colorScheme.surface.luminance() < 0.5f
        BeamTheme.DARK -> true
        BeamTheme.LIGHT -> false
    }
    val config = remember(spec, size, colorVariant, dark, cornerRadius, strength) {
        BeamConfig(spec, size, colorVariant, dark, cornerRadius.value.toDouble(), strength.toDouble())
    }
    val painter = remember(config) { BeamPainter.create(config) } ?: return@composed this
    val clock = remember(config) { BeamClock(BeamFader(config.fadeInSeconds, config.fadeOutSeconds)) }
    val bloomLayer = rememberGraphicsLayer()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(clock, active, lifecycle) { clock.run(active, lifecycle) }
    this.drawWithContent {
        drawContent()
        val seconds = clock.seconds
        val fade = clock.fader.value(seconds)
        if (fade > 0.0) with(painter) { drawBeam(seconds, fade, bloomLayer) }
    }
}
