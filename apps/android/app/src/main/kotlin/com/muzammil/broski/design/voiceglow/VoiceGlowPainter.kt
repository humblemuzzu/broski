package com.muzammil.broski.design.voiceglow

import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.GraphicsContext
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.layer.CompositingStrategy
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.unit.IntSize
import kotlin.math.ceil

/** One [VoiceGlowShaders.LAYER] shader with the paint that draws it. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class LayerShader(blendMode: BlendMode = BlendMode.SrcOver) {
    private val shader = RuntimeShader(VoiceGlowShaders.LAYER)
    val paint = Paint().also {
        it.shader = shader
        it.blendMode = blendMode
        it.isAntiAlias = true
    }

    fun fillRect(canvas: Canvas, inputs: VoiceGlowLayerInputs, width: Float, height: Float) {
        shader.setFloatUniform("size", width, height)
        shader.setFloatUniform("lobes", inputs.lobes)
        shader.setFloatUniform("highlight", inputs.highlight)
        shader.setFloatUniform("mask", inputs.mask)
        shader.setFloatUniform("params", inputs.params)
        canvas.drawRect(0f, 0f, width, height, paint)
    }
}

/** Sets a Gaussian blur of [radiusDp] on the layer, as CSS `blur()` and SwiftUI's `.blur(radius:)` mean it. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal fun GraphicsLayer.blur(radiusDp: Double, density: Float) {
    val px = (radiusDp * density).toFloat()
    renderEffect = BlurEffect(px, px, TileMode.Decal)
}

/**
 * Draws the glow's layers for one frame, bottom to top as the web stacks them: inner light, edge
 * stroke, the blurred and masked bloom, then the band. Everything is laid out in dp and drawn under a
 * density scale; the blurs are layers of their own, as CSS blurs a layer before it masks it.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class VoiceGlowPainter(
    private val graphics: GraphicsContext,
    private val config: VoiceGlowConfig,
    private val density: Float,
) {
    private val inputs = VoiceGlowLayerInputs(config)
    private val inner = LayerShader()
    private val stroke = LayerShader()
    private val bloom = LayerShader()
    private val bloomMask = LayerShader(BlendMode.DstIn)
    private val band = VoiceGlowBandPainter(graphics, config, density)
    private val bloomLayer = graphics.createGraphicsLayer().also { it.blur(inputs.bloomBlur, density) }
    private val bloomMasked = graphics.createGraphicsLayer().also { it.compositingStrategy = CompositingStrategy.Offscreen }

    private lateinit var frame: VoiceGlowFrame
    private var width = 0.0
    private var height = 0.0

    private val recordBloom: DrawScope.() -> Unit = {
        fillScaled(drawContext.canvas, bloom, VoiceGlowLayerInputs.KIND_BLOOM)
    }
    private val recordBloomMasked: DrawScope.() -> Unit = {
        drawLayer(bloomLayer)
        fillScaled(drawContext.canvas, bloomMask, VoiceGlowLayerInputs.KIND_MASK)
    }

    fun draw(scope: DrawScope, frame: VoiceGlowFrame, width: Double, height: Double) {
        this.frame = frame
        this.width = width
        this.height = height
        val canvas = scope.drawContext.canvas
        fillScaled(canvas, inner, VoiceGlowLayerInputs.KIND_INNER)
        fillScaled(canvas, stroke, VoiceGlowLayerInputs.KIND_STROKE)

        val size = IntSize(ceil(width * density).toInt(), ceil(height * density).toInt())
        bloomLayer.record(scope, scope.layoutDirection, size, recordBloom)
        bloomMasked.record(scope, scope.layoutDirection, size, recordBloomMasked)
        bloomMasked.alpha = inputs.bloomOpacity(frame).toFloat()
        scope.drawLayer(bloomMasked)

        band.draw(scope, frame, width, height, size)
    }

    fun release() {
        graphics.releaseGraphicsLayer(bloomLayer)
        graphics.releaseGraphicsLayer(bloomMasked)
        band.release()
    }

    private fun fillScaled(canvas: Canvas, shader: LayerShader, kind: Int) {
        inputs.fill(kind, frame, width, height)
        canvas.save()
        canvas.scale(density, density)
        shader.fillRect(canvas, inputs, width.toFloat(), height.toFloat())
        canvas.restore()
    }
}
