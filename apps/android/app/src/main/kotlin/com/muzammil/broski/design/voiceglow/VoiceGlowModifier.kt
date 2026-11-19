package com.muzammil.broski.design.voiceglow

import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.LayoutAwareModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.ObserverModifierNode
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.node.observeReads
import androidx.compose.ui.node.requireDensity
import androidx.compose.ui.node.requireGraphicsContext
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.muzammil.broski.design.DarkSemanticColors
import com.muzammil.broski.design.LocalSemanticColors
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

private const val TAG = "VoiceGlow"

/**
 * Sound-reactive glow rising from the bottom edge of the content, inside its rounded shape: a port
 * of the MIT-licensed Voice Glow (see LICENSE here) through VoiceGlowKit's SwiftUI version.
 *
 * [level] (0…1) is read every frame in the draw phase, so a level that changes many times a second
 * recomposes nothing. [active] fades the glow in (0.6 s) and out (0.5 s); at rest nothing runs. The
 * glow takes no touches and changes no layout. [cornerRadius] is the wrapped shape's, [theme]
 * [VoiceGlowTheme.AUTO] follows the app's appearance.
 *
 * Needs API 33 (AGSL); below that, and if the shaders fail to compile, it draws nothing.
 */
fun Modifier.voiceGlow(
    level: () -> Float,
    active: Boolean,
    cornerRadius: Dp,
    type: VoiceGlowType = VoiceGlowType.STANDARD,
    colorVariant: VoiceGlowColorVariant = VoiceGlowColorVariant.COLORFUL,
    theme: VoiceGlowTheme = VoiceGlowTheme.AUTO,
): Modifier = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    this then VoiceGlowElement(level, active, cornerRadius, type, colorVariant, theme)
} else {
    this
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private data class VoiceGlowElement(
    val level: () -> Float,
    val active: Boolean,
    val cornerRadius: Dp,
    val type: VoiceGlowType,
    val colorVariant: VoiceGlowColorVariant,
    val theme: VoiceGlowTheme,
) : ModifierNodeElement<VoiceGlowNode>() {
    override fun create() = VoiceGlowNode(level, active, cornerRadius, type, colorVariant, theme)

    override fun update(node: VoiceGlowNode) = node.update(level, active, cornerRadius, type, colorVariant, theme)

    override fun InspectorInfo.inspectableProperties() {
        name = "voiceGlow"
        properties["active"] = active
        properties["cornerRadius"] = cornerRadius
        properties["type"] = type
        properties["colorVariant"] = colorVariant
        properties["theme"] = theme
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class VoiceGlowNode(
    private var level: () -> Float,
    private var active: Boolean,
    private var cornerRadius: Dp,
    private var type: VoiceGlowType,
    private var colorVariant: VoiceGlowColorVariant,
    private var theme: VoiceGlowTheme,
) : Modifier.Node(), DrawModifierNode, CompositionLocalConsumerModifierNode, LayoutAwareModifierNode, ObserverModifierNode {
    private val engine = VoiceGlowEngine()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val clip = Path()
    private var clipKey = IntSize.Zero
    private var clipRadius = 0f
    private var sizePx = IntSize.Zero
    private var reducedMotion = false
    private var config: VoiceGlowConfig? = null
    private var painter: VoiceGlowPainter? = null
    private var failed = false
    private var owner: LifecycleOwner? = null
    private var loop: Job? = null

    fun update(
        level: () -> Float,
        active: Boolean,
        cornerRadius: Dp,
        type: VoiceGlowType,
        colorVariant: VoiceGlowColorVariant,
        theme: VoiceGlowTheme,
    ) {
        this.level = level
        this.active = active
        this.cornerRadius = cornerRadius
        this.type = type
        this.colorVariant = colorVariant
        this.theme = theme
        wake.trySend(Unit)
        invalidateDraw()
    }

    override fun onAttach() = followLifecycleOwner()

    override fun onObservedReadsChanged() = followLifecycleOwner()

    override fun onDetach() {
        painter?.release()
        painter = null
        owner = null
    }

    /** The loop runs only while the lifecycle of the composition it is in is resumed, and follows that owner if it is replaced. */
    private fun followLifecycleOwner() {
        var current: LifecycleOwner? = null
        observeReads { current = currentValueOf(LocalLifecycleOwner) }
        if (current === owner) return
        owner = current
        loop?.cancel()
        val lifecycle = current?.lifecycle ?: return
        loop = coroutineScope.launch { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { frameLoop() } }
    }

    override fun onRemeasured(size: IntSize) {
        sizePx = size
    }

    /**
     * Frames only while the glow is visible or fading and the screen is resumed; otherwise it waits to
     * be woken. A fade is a finite animation; only the shown glow's endless life is an infinite one,
     * which an [androidx.compose.ui.platform.InfiniteAnimationPolicy] (a UI test's) may stop.
     */
    private suspend fun frameLoop() {
        engine.restartClock()
        readReducedMotion()
        while (!failed) {
            if (!active && !engine.isVisible) {
                wake.receive()
                engine.restartClock()
                readReducedMotion()
                continue
            }
            val nanos = if (engine.isFading(active)) withFrameNanos { it } else withInfiniteAnimationFrameNanos { it }
            val seconds = nanos / NANOS_PER_SECOND
            val density = requireDensity().density.toDouble()
            engine.step(seconds, level().toDouble(), active, configFor(), sizePx.width / density, sizePx.height / density)
            invalidateDraw()
        }
    }

    private fun readReducedMotion() {
        val resolver = currentValueOf(LocalContext).contentResolver
        reducedMotion = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) <= 0f
    }

    /** The app's own appearance, not the system's: its theme provides the semantic colours of the scheme it picked. */
    private fun isDark(): Boolean = when (theme) {
        VoiceGlowTheme.DARK -> true
        VoiceGlowTheme.LIGHT -> false
        VoiceGlowTheme.AUTO -> currentValueOf(LocalSemanticColors) === DarkSemanticColors
    }

    private fun configFor(): VoiceGlowConfig {
        val dark = isDark()
        val radius = cornerRadius.value.toDouble()
        val current = config
        if (current != null && current.type == type && current.dark == dark && current.colorVariant == colorVariant &&
            current.cornerRadius == radius && current.reducedMotion == reducedMotion
        ) {
            return current
        }
        painter?.release()
        painter = null
        return VoiceGlowConfig(type, dark, colorVariant, radius, reducedMotion).also { config = it }
    }

    override fun ContentDrawScope.draw() {
        drawContent()
        val config = config
        if (config == null || failed || engine.frame.presence <= VISIBLE_PRESENCE) return
        try {
            paint(config)
        } catch (e: RuntimeException) {
            failed = true
            Log.w(TAG, "the glow's shaders failed, drawing nothing", e)
        }
    }

    private fun DrawScope.paint(config: VoiceGlowConfig) {
        val painter = painter ?: VoiceGlowPainter(requireGraphicsContext(), config, density).also { painter = it }
        val canvas = drawContext.canvas
        canvas.save()
        canvas.clipPath(roundedClip())
        painter.draw(this, engine.frame, size.width / density.toDouble(), size.height / density.toDouble())
        canvas.restore()
    }

    private fun DrawScope.roundedClip(): Path {
        val radius = minOf(cornerRadius.toPx(), size.width / 2, size.height / 2)
        val key = IntSize(size.width.toInt(), size.height.toInt())
        if (key != clipKey || radius != clipRadius) {
            clip.rewind()
            clip.addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(radius)))
            clipKey = key
            clipRadius = radius
        }
        return clip
    }

    private companion object {
        const val NANOS_PER_SECOND = 1_000_000_000.0
        const val VISIBLE_PRESENCE = 0.002
    }
}
