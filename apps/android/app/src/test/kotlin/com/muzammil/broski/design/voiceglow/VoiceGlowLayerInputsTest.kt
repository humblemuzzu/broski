package com.muzammil.broski.design.voiceglow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the layer shader is fed, from VoiceGlowKit's `VoiceGlowLayers` formulas on a known frame. */
class VoiceGlowLayerInputsTest {
    private val config = VoiceGlowConfig(VoiceGlowType.STANDARD, true, VoiceGlowColorVariant.COLORFUL, 26.0, false)

    private fun frame(): VoiceGlowFrame {
        val engine = VoiceGlowEngine()
        var t = 100.0
        lateinit var f: VoiceGlowFrame
        repeat(12) { i ->
            f = engine.step(t, if (i < 6) 0.0 else 0.6, true, config, 340.0, 100.0)
            t += 1.0 / 60
        }
        return f
    }

    @Test
    fun lobeRadiiAreRoundedHalfAwayFromZeroThenScaledByTheFrame() {
        val f = frame()
        val inputs = VoiceGlowLayerInputs(config)
        inputs.fill(VoiceGlowLayerInputs.KIND_STROKE, f, 340.0, 100.0)
        assertEquals((48 * f.w).toFloat(), inputs.lobes[2], 1e-4f)
        assertEquals((58 * f.h * f.lobeL[0]).toFloat(), inputs.lobes[3], 1e-4f)
        assertEquals((170 + f.lobeX[0] * f.w).toFloat(), inputs.lobes[0], 1e-4f)
        assertEquals(102f + f.lobeY[0].toFloat(), inputs.lobes[1], 1e-4f)
        assertEquals(1f, inputs.lobes[7], 0f)
    }

    @Test
    fun theStrokeLayerCarriesTheHighlightAndTheMaskTheInnerLightItsOwn() {
        val f = frame()
        val inputs = VoiceGlowLayerInputs(config)
        inputs.fill(VoiceGlowLayerInputs.KIND_STROKE, f, 340.0, 100.0)
        assertEquals(1f, inputs.params[12], 0f)
        assertEquals(1f, inputs.params[13], 0f)
        assertEquals(7f, inputs.params[11], 0f)
        assertEquals((30 * f.w).toFloat(), inputs.highlight[2], 1e-4f)
        assertEquals(0.45f, inputs.highlight[7], 0f)
        assertEquals(-1f, inputs.mask[5], 0f)
        assertEquals((170 * 0.75 * f.w).toFloat(), inputs.mask[2], 1e-3f)
        assertEquals((64 * f.h + f.lift).toFloat(), inputs.mask[3], 1e-3f)

        inputs.fill(VoiceGlowLayerInputs.KIND_INNER, f, 340.0, 100.0)
        assertEquals(0f, inputs.params[12], 0f)
        assertEquals(0.3f, inputs.mask[5], 0f)
        assertEquals(0.46f, inputs.lobes[7], 0f)
        assertEquals(0.75f, inputs.params[3], 1e-6f)
    }

    @Test
    fun theBloomHasNoMaskOfItsOwnAndAMaskLayerHasNoLobes() {
        val f = frame()
        val inputs = VoiceGlowLayerInputs(config)
        inputs.fill(VoiceGlowLayerInputs.KIND_BLOOM, f, 340.0, 100.0)
        assertEquals(0f, inputs.params[13], 0f)
        assertEquals(0.77f, inputs.params[3], 1e-6f)
        assertEquals(0.9f, inputs.lobes[7], 0f)
        assertEquals(10.0, inputs.bloomBlur, 0.0)
        assertTrue(inputs.bloomOpacity(f) in 0.0..1.0)

        inputs.fill(VoiceGlowLayerInputs.KIND_MASK, f, 340.0, 100.0)
        assertEquals(0f, inputs.params[11], 0f)
        assertEquals(1f, inputs.params[13], 0f)
        assertEquals((200 * 0.75 * f.w).toFloat(), inputs.mask[2], 1e-3f)
    }

    @Test
    fun theCornerRadiusTheShaderRoundsWithIsClampedToTheBox() {
        val big = VoiceGlowConfig(VoiceGlowType.STANDARD, true, VoiceGlowColorVariant.COLORFUL, 80.0, false)
        val inputs = VoiceGlowLayerInputs(big)
        inputs.fill(VoiceGlowLayerInputs.KIND_INNER, frame(), 340.0, 100.0)
        assertEquals(50f, inputs.params[1], 0f)
    }
}
