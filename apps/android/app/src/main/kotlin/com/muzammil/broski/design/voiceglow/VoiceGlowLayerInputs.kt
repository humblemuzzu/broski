package com.muzammil.broski.design.voiceglow

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * What one layer of the glow is drawn from, as the AGSL layer shader takes it (see [VoiceGlowShaders]):
 * the lobes as ellipses with a colour, the highlight, the ellipse the layer is masked to, and the
 * parameters. Filled in place per frame; the layer geometry follows VoiceGlowKit's `VoiceGlowLayers`.
 */
internal class VoiceGlowLayerInputs(private val config: VoiceGlowConfig) {
    /** Each lobe as cx, cy, rx, ry, r, g, b, a. */
    val lobes = FloatArray(VoiceGlowStyle.LOBE_COUNT * LOBE_STRIDE)

    /** cx, cy, rx, ry, r, g, b, then the alpha at the centre, the first stop, the alpha there, the second stop. */
    val highlight = FloatArray(HIGHLIGHT_SIZE)

    /** cx, cy, rx, ry, then the distance at which the alpha is half, and the alpha left at 0.85 (below 0: none). */
    val mask = FloatArray(MASK_SIZE)

    /** kind, corner radius, border width, fade stop, corner fade, inset blur, shadow r g b a, opacity, lobe count, has highlight, has mask. */
    val params = FloatArray(PARAMS_SIZE)

    private val g = config.g
    private val mono = if (config.colorVariant == VoiceGlowColorVariant.MONO) 0.6 else 1.0
    private val fade = max(40.0, min(95.0, roundHalfAway(70 * g.softness))) / 100
    private val shadow = FloatArray(3)

    /** The opacity the blurred, masked bloom is composited with. */
    fun bloomOpacity(frame: VoiceGlowFrame): Double = min(1.0, base(frame) * config.theme.bloomOpacity * mono * g.bloomOpacity)

    /** The bloom's blur radius in dp. */
    val bloomBlur: Double get() = max(0.5, 10 * g.glowSize)

    fun fill(kind: Int, frame: VoiceGlowFrame, width: Double, height: Double) {
        val b = base(frame)
        when (kind) {
            KIND_INNER -> {
                fillLobes(frame, width, height, 0.46, g.glowWidth * 0.9 * g.innerScale, g.glowHeight * 0.9 * g.innerScale * g.innerHeight, 0.0)
                fillMask(frame, width, height, 170.0, 64.0, 0.45, 0.3)
                fillParams(kind, frame, width, height, fade, min(1.0, b * config.theme.innerOpacity * mono * g.innerOpacity), hasLobes = true, hasHighlight = false, hasMask = true)
            }
            KIND_STROKE -> {
                fillLobes(frame, width, height, 1.0, g.glowWidth * g.strokeScale, g.glowHeight * g.strokeScale, 2.0)
                fillHighlight(frame, width, height)
                fillMask(frame, width, height, 170.0, 64.0, 0.45, -1.0)
                fillParams(kind, frame, width, height, fade, min(1.0, b * config.theme.strokeOpacity * mono * g.strokeOpacity), hasLobes = true, hasHighlight = true, hasMask = true)
            }
            KIND_BLOOM -> {
                val sw = g.glowWidth * 1.15 * g.bloomScale
                val sh = g.glowHeight * 1.5 * g.bloomScale * g.bloomHeight
                fillLobes(frame, width, height, if (config.dark) 0.9 else 0.7, sw, sh, 0.0)
                fillParams(kind, frame, width, height, min(95.0, fade * 100 + 2) / 100, 1.0, hasLobes = true, hasHighlight = false, hasMask = false)
            }
            else -> {
                fillMask(frame, width, height, 200.0, 130.0, 0.35, -1.0)
                fillParams(kind, frame, width, height, 1.0, 1.0, hasLobes = false, hasHighlight = false, hasMask = true)
            }
        }
    }

    private fun base(frame: VoiceGlowFrame) = frame.presence * frame.glow * config.strength

    private fun fillLobes(frame: VoiceGlowFrame, width: Double, height: Double, alpha: Double, sw: Double, sh: Double, y: Double) {
        for (i in 0 until VoiceGlowStyle.LOBE_COUNT) {
            val lobe = VoiceGlowStyle.lobes[i]
            val at = i * LOBE_STRIDE
            lobes[at] = (width / 2 + (frame.cx + frame.lobeX[i]) * frame.w).toFloat()
            lobes[at + 1] = (height + y + frame.lobeY[i]).toFloat()
            lobes[at + 2] = (roundHalfAway(lobe.w * sw) * frame.w).toFloat()
            lobes[at + 3] = (roundHalfAway(lobe.h * sh) * frame.h * frame.lobeL[i]).toFloat()
            lobes[at + 4] = frame.colors[i * 3]
            lobes[at + 5] = frame.colors[i * 3 + 1]
            lobes[at + 6] = frame.colors[i * 3 + 2]
            lobes[at + 7] = alpha.toFloat()
        }
    }

    /** The ellipse every layer is masked to: on the beam, growing with the level, humped by the bend, narrowed into a beam while gathered. */
    private fun fillMask(frame: VoiceGlowFrame, width: Double, height: Double, w: Double, h: Double, mid: Double, tail: Double) {
        mask[0] = (width / 2 + frame.cx * frame.w).toFloat()
        mask[1] = (height + frame.cy).toFloat()
        mask[2] = (w * g.rangeWidth * frame.w * frame.maskWidth).toFloat()
        mask[3] = (h * g.rangeHeight * frame.h + frame.lift).toFloat()
        mask[4] = mid.toFloat()
        mask[5] = tail.toFloat()
    }

    /** The hot core at the centre of the edge: white on dark, ink on light. */
    private fun fillHighlight(frame: VoiceGlowFrame, width: Double, height: Double) {
        val dark = config.dark
        highlight[0] = (width / 2 + frame.cx * frame.w).toFloat()
        highlight[1] = (height + 2 + frame.cy).toFloat()
        highlight[2] = ((if (dark) 30 else 40) * g.coreSize * frame.w).toFloat()
        highlight[3] = (30 * g.coreSize * frame.h).toFloat()
        VoiceColorMatrix.apply(frame.colorMatrix, if (dark) 0xFFFFFF else 0x000000, highlight, 4)
        highlight[7] = if (dark) 0.45f else 0.55f
        highlight[8] = if (dark) 0.30f else 0.35f
        highlight[9] = if (dark) 0.14f else 0.22f
        highlight[10] = if (dark) 0.65f else 0.70f
    }

    private fun fillParams(
        kind: Int,
        frame: VoiceGlowFrame,
        width: Double,
        height: Double,
        fadeStop: Double,
        opacity: Double,
        hasLobes: Boolean,
        hasHighlight: Boolean,
        hasMask: Boolean,
    ) {
        VoiceColorMatrix.apply(frame.colorMatrix, config.theme.innerShadow, shadow, 0)
        params[0] = kind.toFloat()
        params[1] = VoiceGlowEngine.paintedRadius(config.cornerRadius, width, height).toFloat()
        params[2] = VoiceGlowStyle.BORDER_WIDTH.toFloat()
        params[3] = fadeStop.toFloat()
        params[4] = (28 * g.scale).toFloat()
        params[5] = (9 * g.scale).toFloat()
        params[6] = shadow[0]
        params[7] = shadow[1]
        params[8] = shadow[2]
        params[9] = config.theme.innerShadowAlpha.toFloat()
        params[10] = opacity.toFloat()
        params[11] = if (hasLobes) VoiceGlowStyle.LOBE_COUNT.toFloat() else 0f
        params[12] = if (hasHighlight) 1f else 0f
        params[13] = if (hasMask) 1f else 0f
    }

    companion object {
        const val KIND_STROKE = 0
        const val KIND_INNER = 1
        const val KIND_BLOOM = 2
        const val KIND_MASK = 3
        const val LOBE_STRIDE = 8
        const val HIGHLIGHT_SIZE = 11
        const val MASK_SIZE = 6
        const val PARAMS_SIZE = 14

        /** Swift's `.rounded()`: halves away from zero. */
        fun roundHalfAway(x: Double): Double = if (x < 0) -floor(-x + 0.5) else floor(x + 0.5)
    }
}
