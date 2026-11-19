package com.muzammil.broski.design.voiceglow

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The band: an organic bell along the glow's ceiling, traced by a core light with a red fringe above
 * and a blue one below that split further and thicken with the voice, and in the light theme a soft
 * white wash at its source. A port of `bandPoints` / `drawBand` / `drawCoreWash` from VoiceGlowKit's
 * `VoiceGlowBand`, as numbers the painter draws without further thought. Dimensions are dp.
 */
internal class VoiceGlowBandPlan(private val config: VoiceGlowConfig) {
    val xs = DoubleArray(POINTS)
    val ys = DoubleArray(POINTS)

    var drawsBand = false
        private set
    var thickness = 0.0
        private set

    /** The blur radii of the ridges, the halo (three times the ridges') and the wash, dp. */
    val ridgeBlur = 3.5 * config.g.bandWidth / 2
    val haloBlur = ridgeBlur * 3
    val washBlur = max(0.5, 8 * config.g.glowSize)

    var base = 0.0
        private set
    var fadeStop = 0.0
        private set

    /** The ridges' sideways and vertical offsets, in [RIDGES] order. */
    val ridgeDx = DoubleArray(RIDGES)
    val ridgeDy = DoubleArray(RIDGES)

    /** The colours through the filter chain as r, g, b: core, above, mid, below. */
    val colors = FloatArray(12)

    var drawsWash = false
        private set
    var washOpacity = 0.0
        private set

    /** cx, cy, rx, ry of the wash's ellipse. */
    val washEllipse = FloatArray(4)

    /** Where the wash's white is solid, where it is `washMidAlpha`, and where it is gone. */
    val washStops = FloatArray(3)
    var washMidAlpha = 0f
        private set

    fun prepare(frame: VoiceGlowFrame, cw: Double, ch: Double) {
        points(frame, cw, ch)
        prepareBand(frame)
        prepareWash(frame, cw, ch)
    }

    private fun points(f: VoiceGlowFrame, cw: Double, ch: Double) {
        val g = config.g
        val centre = cw / 2 + f.cx * f.w
        val half = VoiceGlowStyle.CEILING_HALF_WIDTH * g.rangeWidth * f.w * f.maskWidth
        val apexCap = ch * 0.82 * min(1.0, g.scale)
        val apex = min(apexCap, (VoiceGlowStyle.CEILING_HEIGHT * g.rangeHeight * f.h + f.lift) * g.bandPosition)
        val baseY = ch - g.bandOffset
        val tailT = min(1.0, f.morph * 4)
        val tail = g.bandTail * (1 - tailT * tailT * (3 - 2 * tailT))
        val withTail = tail > 0.001
        val over = if (withTail) g.bandTailOverflow else 0.0
        val x0 = if (withTail) -over else centre - half
        val x1 = if (withTail) cw + over else centre + half
        val radius = VoiceGlowEngine.paintedRadius(config.cornerRadius, cw, ch)
        for (i in 0 until POINTS) {
            val x = x0 + (x1 - x0) * i / SAMPLES
            val t = max(-1.0, min(1.0, (x - centre) / max(1.0, half)))
            val edge = (if (x < centre) centre else cw - centre) + over
            val y = bell(t, g.bandCurve, g.bandSpread, g.bandSkew) +
                tailLift(abs(x - centre), edge, tail, g.bandTailPosition, g.bandTailCurve)
            val arc = if (f.morph > 0) VoiceGlowEngine.cornerLift(x, cw, radius) * f.morph else 0.0
            xs[i] = x
            ys[i] = baseY - apex * y - arc
        }
    }

    private fun prepareBand(f: VoiceGlowFrame) {
        val g = config.g
        val alpha = min(1.0, 0.6 * g.bandStrength * f.bendA)
        drawsBand = alpha >= 0.005 && g.bandWidth > 0
        if (!drawsBand) return
        val bands = VoiceGlowStyle.bandColors(config.dark)
        val m = f.colorMatrix
        VoiceColorMatrix.apply(m, bands.core, colors, 0)
        VoiceColorMatrix.apply(m, bands.above, colors, 3)
        VoiceColorMatrix.apply(m, bands.mid, colors, 6)
        VoiceColorMatrix.apply(m, bands.below, colors, 9)
        val bw = g.bandWidth * (1 + 0.35 * f.level)
        val split = g.bandAberration * (0.35 + 0.65 * f.level)
        val dy = (4 + 12 * split) * g.scale
        val dx = 4 * split * g.scale
        ridgeDx[0] = dx
        ridgeDy[0] = -dy
        ridgeDx[1] = dx * 0.35
        ridgeDy[1] = -dy * 0.35
        ridgeDx[2] = -dx
        ridgeDy[2] = dy
        ridgeDx[3] = 0.0
        ridgeDy[3] = 0.0
        base = (if (config.dark) 0.42 else 0.4) * alpha
        thickness = 14 * bw
        fadeStop = if (g.bandTail > 0) 0.015 else 0.18
    }

    private fun prepareWash(f: VoiceGlowFrame, cw: Double, ch: Double) {
        val g = config.g
        val coreLight = max(0.0, min(3.0, g.coreLight))
        drawsWash = false
        if (coreLight <= 0) return
        val boost = max(0.0, min(2.0, coreLight - 1))
        val b1 = min(1.0, boost)
        val b2 = max(0.0, boost - 1)
        val grow = 1 + 0.3 * boost
        washOpacity = f.presence * min(1.0, f.glow * min(1.0, coreLight) * (1.6 + 1.4 * boost))
        val rx = 120 * g.coreLightWidth * grow * g.scale * f.w
        val ry = 70 * g.coreLightHeight * grow * g.scale * f.h + f.lift
        if (washOpacity <= 0.005 || rx <= 0 || ry <= 0) return
        drawsWash = true
        washEllipse[0] = (cw / 2 + f.cx * f.w).toFloat()
        washEllipse[1] = (ch + f.cy).toFloat()
        washEllipse[2] = rx.toFloat()
        washEllipse[3] = ry.toFloat()
        washStops[0] = ((45 * b1 + 27 * b2) / 100).toFloat()
        washStops[1] = ((40 + 25 * b1 + 15 * b2) / 100).toFloat()
        washStops[2] = ((72 + 14 * b1 + 8 * b2) / 100).toFloat()
        washMidAlpha = min(1.0, 0.55 + 0.35 * b1 + 0.1 * b2).toFloat()
    }

    companion object {
        const val SAMPLES = 56
        const val POINTS = SAMPLES + 1
        const val RIDGES = 4
        const val CORE = 0
        const val ABOVE = 1
        const val MID = 2
        const val BELOW = 3

        /** Each ridge's share of the band's strength, in the order core's fringes are drawn: above, mid, below, core. */
        val RIDGE_ALPHA = doubleArrayOf(1.0, 0.55, 1.0, 0.9)

        /** Which colour of [colors] each ridge takes. */
        val RIDGE_COLOR = intArrayOf(ABOVE, MID, BELOW, CORE)

        /** The ridge's stacked strokes: a linear ramp across its thickness, as width and alpha shares. */
        val RAMP_WIDTH = doubleArrayOf(1.0, 0.72, 0.46, 0.22)
        val RAMP_ALPHA = doubleArrayOf(0.16, 0.2, 0.26, 0.34)

        /** `exp(-(|t| / σ)^p)`, 1 at the centre and exactly 0 at the ends. */
        fun bell(t: Double, p: Double, sigma: Double, skew: Double): Double {
            val side = if (t < 0) 1 - skew else 1 + skew
            val s = max(0.05, sigma * side)
            val v = exp(-(abs(t) / s).pow(p))
            val tail = exp(-(1 / s).pow(p))
            return max(0.0, (v - tail) / (1 - tail))
        }

        /** The ends rise again toward the corners. */
        fun tailLift(dist: Double, edge: Double, lift: Double, position: Double, curve: Double): Double {
            if (lift <= 0 || edge <= 0) return 0.0
            val start = edge * max(0.0, min(0.98, position))
            if (dist <= start) return 0.0
            val u = min(1.0, (dist - start) / max(1.0, edge - start))
            return lift * u.pow(max(0.5, curve))
        }
    }
}
