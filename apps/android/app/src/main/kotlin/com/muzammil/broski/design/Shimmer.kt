package com.muzammil.broski.design

import android.provider.Settings
import androidx.compose.animation.core.InfiniteRepeatableSpec
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState

/** Whether the person left animations on (Settings › Accessibility › Remove animations is off). */
@Composable
fun animationsEnabled(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f }
}

/** other clients's sweep: 1,350 ms across the text, then 1,450 ms of rest. */
private val ShimmerCycle: InfiniteRepeatableSpec<Float> = infiniteRepeatable(
    animation = keyframes {
        durationMillis = 2_800
        0f at 0 using LinearEasing
        1f at 1_350
        1f at 2_800
    },
    repeatMode = RepeatMode.Restart,
)

/**
 * A band of [highlight] sweeping across the text this modifies, the "alive" mark of the one live
 * line. It runs only while composed (a list composes what is on screen), the screen is resumed and
 * animations are on; otherwise the text stands still.
 */
@Composable
fun Modifier.shimmer(highlight: Color): Modifier {
    val resumed by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    if (!animationsEnabled() || !resumed.isAtLeast(Lifecycle.State.RESUMED)) return this
    val progress by rememberInfiniteTransition(label = "shimmer").animateFloat(0f, 1f, ShimmerCycle, label = "sweep")
    val band = with(LocalDensity.current) { 72.dp.toPx() }
    return graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen).drawWithContent {
        drawContent()
        val x = -band + (size.width + 2 * band) * progress
        val brush = Brush.linearGradient(
            colors = listOf(Color.Transparent, highlight, Color.Transparent),
            start = Offset(x - band, 0f),
            end = Offset(x + band, 0f),
        )
        drawRect(brush, blendMode = BlendMode.SrcAtop)
    }
}
