package com.muzammil.broski.design.beam

import android.graphics.RuntimeShader
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.unit.IntSize

/**
 * Draws the three layers of the rotate beam as BorderBeamKit's `RotateBeamLayers` stacks them, in the
 * web's z-order: the inner glow, the stroke ring, and the bloom ring, blurred by [BeamConfig.bloomBlurPx]
 * (a `RenderEffect` blur on a graphics layer, which spills past the element as iOS's does).
 *
 * Each layer is its own [RuntimeShader] over [BeamAgslSource]. What a layer never changes is set once
 * here; a frame sets only the beam angle, the filter matrix and the opacity, into arrays and objects
 * built up front. A shader that does not compile, or one that throws while drawing, retires the painter
 * for good: it draws nothing from then on rather than take the app down.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class BeamPainter private constructor(private val config: BeamConfig, private val layers: List<LayerShader>) {
    private class LayerShader(val layer: BeamLayer, val shader: RuntimeShader) {
        val brush = ShaderBrush(shader)
    }

    private val inner = layers[0]
    private val stroke = layers[1]
    private val bloom = layers[2]
    private val filterMatrix = FloatArray(BeamColorMatrix.SIZE)
    private val scratch = BeamColorMatrix.Scratch()
    private val recordBloom: DrawScope.() -> Unit = { drawRect(bloom.brush) }
    private var boundWidth = 0f
    private var boundHeight = 0f
    private var boundDensity = 0f
    private var retired = false

    /** Draws the beam at [seconds] and [fade] over the element; the bloom goes through [bloomLayer]. */
    fun DrawScope.drawBeam(seconds: Double, fade: Double, bloomLayer: GraphicsLayer) {
        if (retired) return
        try {
            bind(size.width, size.height, density, bloomLayer)
            val angle = config.angle(seconds).toFloat()
            val base = config.baseOpacity(fade)
            config.filterMatrixInto(filterMatrix, seconds, scratch)
            frame(inner, angle, filterMatrix, base)
            drawRect(inner.brush)
            frame(stroke, angle, filterMatrix, base)
            drawRect(stroke.brush)
            frame(bloom, angle, config.bloomMatrix, base)
            bloomLayer.record(this, layoutDirection, IntSize(size.width.toInt(), size.height.toInt()), recordBloom)
            drawLayer(bloomLayer)
        } catch (error: RuntimeException) {
            retired = true
            Log.w(TAG, "the beam shader failed; drawing no beam", error)
        }
    }

    private fun frame(layer: LayerShader, angle: Float, matrix: FloatArray, base: Double) {
        layer.shader.setFloatUniform(BeamUniform.ANGLE, angle)
        layer.shader.setFloatUniform(BeamUniform.MATRIX, matrix)
        layer.shader.setFloatUniform(BeamUniform.OPACITY, (base * layer.layer.opacity).toFloat())
    }

    private fun bind(width: Float, height: Float, density: Float, bloomLayer: GraphicsLayer) {
        if (width == boundWidth && height == boundHeight && density == boundDensity) return
        for (entry in layers) {
            entry.shader.setFloatUniform(BeamUniform.SIZE, width / density, height / density)
            entry.shader.setFloatUniform(BeamUniform.DENSITY, density)
        }
        val blur = (config.bloomBlurPx * density).toFloat()
        bloomLayer.renderEffect = BlurEffect(blur, blur, TileMode.Decal)
        boundWidth = width
        boundHeight = height
        boundDensity = density
    }

    companion object {
        private const val TAG = "BorderBeam"

        /** A painter for [config], or null when its shader does not compile on this device. */
        fun create(config: BeamConfig): BeamPainter? = try {
            BeamPainter(config, listOf(config.inner, config.stroke, config.bloom).map { layerShader(config, it) })
        } catch (error: RuntimeException) {
            Log.w(TAG, "the beam shader did not compile; drawing no beam", error)
            null
        }

        private fun layerShader(config: BeamConfig, layer: BeamLayer): LayerShader {
            val shader = RuntimeShader(BeamAgslSource)
            shader.setFloatUniform(BeamUniform.CORNER_RADIUS, config.cornerRadius.toFloat())
            shader.setFloatUniform(BeamUniform.BORDER_WIDTH, config.borderWidth.toFloat())
            shader.setFloatUniform(BeamUniform.KIND, layer.kind.toFloat())
            shader.setFloatUniform(BeamUniform.EDGE_MASK, layer.edgeMaskPx.toFloat())
            shader.setFloatUniform(BeamUniform.BG_IS_BLACK, if (layer.bgIsBlack) 1f else 0f)
            val shadow = layer.shadow
            shader.setFloatUniform(BeamUniform.SHADOW_COLOR, shadow.r.toFloat(), shadow.g.toFloat(), shadow.b.toFloat(), shadow.a.toFloat())
            shader.setFloatUniform(BeamUniform.SHADOW_BLUR, layer.shadowBlur.toFloat())
            shader.setArray(BeamUniform.BLOBS, BeamUniform.BLOB_COUNT, layer.blobs, BLOB_FLOATS, BeamLimits.BLOBS)
            shader.setArray(BeamUniform.BG, BeamUniform.BG_COUNT, layer.bg, 2, BeamLimits.STOPS)
            shader.setArray(BeamUniform.MASK, BeamUniform.MASK_COUNT, layer.maskStops, 2, BeamLimits.STOPS)
            return LayerShader(layer, shader)
        }

        /** [values] padded to the uniform array's full length, with how many entries of [stride] floats are real. */
        private fun RuntimeShader.setArray(name: String, countName: String, values: FloatArray, stride: Int, capacity: Int) {
            setFloatUniform(name, values.copyOf(capacity * stride))
            setIntUniform(countName, minOf(values.size / stride, capacity))
        }
    }
}
