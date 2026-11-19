package com.muzammil.broski.design.voiceglow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceGlowBandPlanTest {
    private fun frame(config: VoiceGlowConfig, level: Double): VoiceGlowFrame {
        val engine = VoiceGlowEngine()
        var t = 0.0
        lateinit var f: VoiceGlowFrame
        repeat(30) {
            f = engine.step(t, level, true, config, 340.0, 100.0)
            t += 0.05
        }
        return f
    }

    @Test
    fun theLineRisesToItsApexAtTheCentreAndStaysOnTheBaselineAtTheEnds() {
        val config = VoiceGlowConfig(VoiceGlowType.PILL, true, VoiceGlowColorVariant.COLORFUL, 22.0, false)
        val f = frame(config, 0.8)
        val plan = VoiceGlowBandPlan(config)
        plan.prepare(f, 150.0, 44.0)
        val baseY = 44.0 - config.g.bandOffset
        val mid = VoiceGlowBandPlan.POINTS / 2
        assertEquals(75.0, plan.xs[mid], 1e-9)
        assertTrue(plan.ys[mid] < baseY)
        assertEquals(baseY, plan.ys[0], 1e-9)
        assertEquals(baseY, plan.ys[VoiceGlowBandPlan.POINTS - 1], 1e-9)
        assertTrue(plan.drawsBand)
    }

    @Test
    fun aTypeWithATailSpansTheWholeWidthPastTheEdges() {
        val config = VoiceGlowConfig(VoiceGlowType.STANDARD, true, VoiceGlowColorVariant.COLORFUL, 26.0, false)
        val plan = VoiceGlowBandPlan(config)
        plan.prepare(frame(config, 0.6), 340.0, 100.0)
        assertEquals(-config.g.bandTailOverflow, plan.xs[0], 1e-9)
        assertEquals(340.0 + config.g.bandTailOverflow, plan.xs[VoiceGlowBandPlan.POINTS - 1], 1e-9)
        assertEquals(0.015, plan.fadeStop, 0.0)
    }

    @Test
    fun theWashIsOnlyForTheLightTheme() {
        val dark = VoiceGlowConfig(VoiceGlowType.STANDARD, true, VoiceGlowColorVariant.COLORFUL, 26.0, false)
        val light = VoiceGlowConfig(VoiceGlowType.STANDARD, false, VoiceGlowColorVariant.COLORFUL, 26.0, false)
        val darkPlan = VoiceGlowBandPlan(dark)
        darkPlan.prepare(frame(dark, 0.6), 340.0, 100.0)
        assertFalse(darkPlan.drawsWash)
        val lightPlan = VoiceGlowBandPlan(light)
        lightPlan.prepare(frame(light, 0.6), 340.0, 100.0)
        assertTrue(lightPlan.drawsWash)
        assertEquals(0.36f, lightPlan.washStops[0], 1e-6f)
        assertEquals(0.6f, lightPlan.washStops[1], 1e-6f)
        assertEquals(0.832f, lightPlan.washStops[2], 1e-6f)
        assertEquals(0.83f, lightPlan.washMidAlpha, 1e-6f)
    }

    @Test
    fun aFrameWithoutBendDrawsNoBand() {
        val config = VoiceGlowConfig(VoiceGlowType.STANDARD, true, VoiceGlowColorVariant.COLORFUL, 26.0, false)
        val plan = VoiceGlowBandPlan(config)
        plan.prepare(VoiceGlowFrame(), 340.0, 100.0)
        assertFalse(plan.drawsBand)
    }
}
