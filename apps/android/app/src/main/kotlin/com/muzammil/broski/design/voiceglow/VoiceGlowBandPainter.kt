package com.muzammil.broski.design.voiceglow

import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.GraphicsContext
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.PaintingStyle
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.layer.CompositingStrategy
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.unit.IntSize
import kotlin.math.max

/**
 * The band and the light theme's wash, drawn as VoiceGlowKit's `VoiceGlowBand` canvas does: a hazy
 * halo and the ridges (stacked strokes of one polyline, a fringe above, one below, a core), each a
 * blurred layer, and the wash clipped under the line; all faded together as one group.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class VoiceGlowBandPainter(
    private val graphics: GraphicsContext,
    private val config: VoiceGlowConfig,
    private val density: Float,
) {
    private val plan = VoiceGlowBandPlan(config)
    private val strokeShader = RuntimeShader(VoiceGlowShaders.STROKE)
    private val washShader = RuntimeShader(VoiceGlowShaders.WASH)
    private val strokePaint = Paint().also {
        it.shader = strokeShader
        it.style = PaintingStyle.Stroke
        it.strokeCap = StrokeCap.Round
        it.strokeJoin = StrokeJoin.Round
        it.isAntiAlias = true
    }
    private val washPaint = Paint().also {
        it.shader = washShader
        it.isAntiAlias = true
    }
    private val line = Path()
    private val below = Path()

    private val group = graphics.createGraphicsLayer().also { it.compositingStrategy = CompositingStrategy.Offscreen }
    private val halo = graphics.createGraphicsLayer().also { it.blur(plan.haloBlur, density) }
    private val ridges = graphics.createGraphicsLayer().also { it.blur(plan.ridgeBlur, density) }
    private val wash = graphics.createGraphicsLayer().also { it.blur(plan.washBlur, density) }

    private var width = 0.0
    private var height = 0.0

    private val recordHalo: DrawScope.() -> Unit = {
        scaled(drawContext.canvas) { drawHalo(it) }
    }
    private val recordRidges: DrawScope.() -> Unit = {
        scaled(drawContext.canvas) { drawRidges(it) }
    }
    private val recordWash: DrawScope.() -> Unit = {
        scaled(drawContext.canvas) { drawWash(it) }
    }
    private val recordGroup: DrawScope.() -> Unit = {
        if (plan.drawsBand) {
            drawLayer(halo)
            drawLayer(ridges)
        }
        if (plan.drawsWash) drawLayer(wash)
    }

    fun draw(scope: DrawScope, frame: VoiceGlowFrame, width: Double, height: Double, size: IntSize) {
        this.width = width
        this.height = height
        plan.prepare(frame, width, height)
        if (!plan.drawsBand && !plan.drawsWash) return
        buildLine()
        if (plan.drawsBand) {
            halo.record(scope, scope.layoutDirection, size, recordHalo)
            ridges.record(scope, scope.layoutDirection, size, recordRidges)
        }
        if (plan.drawsWash) {
            wash.alpha = plan.washOpacity.toFloat()
            wash.record(scope, scope.layoutDirection, size, recordWash)
        }
        group.alpha = (frame.presence * config.strength).toFloat()
        group.record(scope, scope.layoutDirection, size, recordGroup)
        scope.drawLayer(group)
    }

    fun release() {
        graphics.releaseGraphicsLayer(group)
        graphics.releaseGraphicsLayer(halo)
        graphics.releaseGraphicsLayer(ridges)
        graphics.releaseGraphicsLayer(wash)
    }

    private inline fun scaled(canvas: Canvas, draw: (Canvas) -> Unit) {
        canvas.save()
        canvas.scale(density, density)
        draw(canvas)
        canvas.restore()
    }

    private fun buildLine() {
        line.rewind()
        below.rewind()
        val last = VoiceGlowBandPlan.POINTS - 1
        below.moveTo(plan.xs[0].toFloat(), (height + 40).toFloat())
        for (i in 0..last) {
            val x = plan.xs[i].toFloat()
            val y = plan.ys[i].toFloat()
            if (i == 0) line.moveTo(x, y) else line.lineTo(x, y)
            below.lineTo(x, y)
        }
        below.lineTo(plan.xs[last].toFloat(), (height + 40).toFloat())
        below.close()
    }

    private fun tint(core: Int, alpha: Double, shiftX: Double) {
        val last = VoiceGlowBandPlan.POINTS - 1
        strokeShader.setFloatUniform("span", (plan.xs[0] - shiftX).toFloat(), (plan.xs[last] - shiftX).toFloat())
        strokeShader.setFloatUniform("fadeStop", plan.fadeStop.toFloat())
        strokeShader.setFloatUniform("tint", plan.colors[core * 3], plan.colors[core * 3 + 1], plan.colors[core * 3 + 2], alpha.toFloat())
    }

    private fun drawHalo(canvas: Canvas) {
        tint(VoiceGlowBandPlan.CORE, plan.base * 0.3, 0.0)
        strokePaint.strokeWidth = (plan.thickness * 2.2).toFloat()
        canvas.drawPath(line, strokePaint)
    }

    private fun drawRidges(canvas: Canvas) {
        for (r in 0 until VoiceGlowBandPlan.RIDGES) {
            canvas.save()
            canvas.translate(plan.ridgeDx[r].toFloat(), plan.ridgeDy[r].toFloat())
            for (k in VoiceGlowBandPlan.RAMP_WIDTH.indices) {
                val alpha = plan.base * VoiceGlowBandPlan.RIDGE_ALPHA[r] * VoiceGlowBandPlan.RAMP_ALPHA[k]
                tint(VoiceGlowBandPlan.RIDGE_COLOR[r], alpha, plan.ridgeDx[r])
                strokePaint.strokeWidth = max(0.6, plan.thickness * VoiceGlowBandPlan.RAMP_WIDTH[k]).toFloat()
                canvas.drawPath(line, strokePaint)
            }
            canvas.restore()
        }
    }

    private fun drawWash(canvas: Canvas) {
        val e = plan.washEllipse
        val s = plan.washStops
        washShader.setFloatUniform("ellipse", e[0], e[1], e[2], e[3])
        washShader.setFloatUniform("stops", s[0], s[1], s[2])
        washShader.setFloatUniform("midAlpha", plan.washMidAlpha)
        canvas.save()
        canvas.clipPath(below)
        canvas.drawRect(0f, 0f, width.toFloat(), (height + 40).toFloat(), washPaint)
        canvas.restore()
    }
}
