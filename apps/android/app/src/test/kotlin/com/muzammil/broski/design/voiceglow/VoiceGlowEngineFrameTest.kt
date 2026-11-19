package com.muzammil.broski.design.voiceglow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Whole engine frames against the numbers VoiceGlowKit's Swift `VoiceGlowEngine.step` gives for the same inputs. */
class VoiceGlowEngineFrameTest {
    private val eps = 1e-8
    private val colorEps = 1e-6

    private fun config(
        type: VoiceGlowType = VoiceGlowType.STANDARD,
        dark: Boolean = true,
        variant: VoiceGlowColorVariant = VoiceGlowColorVariant.COLORFUL,
        radius: Double = 26.0,
        reduced: Boolean = false,
    ) = VoiceGlowConfig(type, dark, variant, radius, reduced)

    private fun assertArray(expected: DoubleArray, actual: DoubleArray, delta: Double = eps) {
        assertEquals(expected.size, actual.size)
        for (i in expected.indices) assertEquals("[$i]", expected[i], actual[i], delta)
    }

    @Test
    fun theFirstFrameOfAFreshEngineAdvancesOneSixtiethOfASecond() {
        val engine = VoiceGlowEngine()
        val f = engine.step(100.0, 0.0, true, config(), 340.0, 100.0)
        assertEquals(0.0, f.level, 0.0)
        assertEquals(0.0022719478738, f.presence, eps)
        assertEquals(0.228040484575, f.glow, eps)
        assertEquals(0.610174801753, f.h, eps)
        assertEquals(0.946402951534, f.w, eps)
        assertEquals(5.50874008763, f.lift, eps)
        assertEquals(0.0918123347939, f.bendA, eps)
        assertEquals(1.0, f.maskWidth, 0.0)
        assertEquals(0.0, f.cx, 0.0)
        assertEquals(0.0, f.cy, 0.0)
        assertArray(
            doubleArrayOf(0.0734498678351, -30.5265501322, 30.6734498678, -61.1265501322, 61.2734498678, -91.7265501322, 91.8734498678),
            f.lobeX,
        )
        assertArray(
            doubleArrayOf(0.599999737756, 0.554702046082, 0.554265031862, 0.418371956838, 0.417497928398, 0.191009470025, 0.189698427364),
            f.lobeL,
        )
        assertTrue(engine.isVisible)
    }

    @Test
    fun theHueMatrixAndLobeColoursAreTheFilterChainOnThePalette() {
        val f = VoiceGlowEngine().step(100.0, 0.0, true, config(), 340.0, 100.0)
        assertArray(
            doubleArrayOf(1.3566939429, 0.322094079347, -0.528788022247, -0.103822160644, 1.10290439008, 0.15091777056, 0.418164946962, -0.480531258154, 1.21236631119),
            f.colorMatrix,
        )
        val first = floatArrayOf(1f, 0.269956f, 0.8567798f, 0.03042575f, 0.9482609f, 0.9527152f)
        for (i in first.indices) assertEquals("[$i]", first[i].toDouble(), f.colors[i].toDouble(), colorEps)
        assertEquals(0.592039, f.colors[20].toDouble(), colorEps)
    }

    @Test
    fun theLevelFollowsTheVoiceAfterSilence() {
        val engine = VoiceGlowEngine()
        val cfg = config()
        var t = 100.0
        lateinit var f: VoiceGlowFrame
        repeat(12) { i ->
            f = engine.step(t, if (i < 6) 0.0 else 0.6, true, cfg, 340.0, 100.0)
            t += 1.0 / 60
        }
        assertEquals(0.231811505426, f.level, eps)
        assertEquals(0.259259259259, f.presence, eps)
        assertEquals(0.419869924247, f.glow, eps)
        assertEquals(0.880992834232, f.h, eps)
        assertEquals(1.18336872995, f.w, eps)
        assertEquals(19.0496417116, f.lift, eps)
        assertEquals(0.317494028526, f.bendA, eps)
        assertEquals(1.57984765064, f.lobeX[0], eps)
        assertEquals(0.762355256862, f.lobeL[0], eps)
        assertEquals(0.70987479316, f.lobeL[1], eps)
        assertEquals(0.223646742537, f.lobeL[6], eps)
    }

    @Test
    fun presenceFadesInOverSixTenthsOfASecondAndOutOverAHalf() {
        val engine = VoiceGlowEngine()
        val cfg = config(dark = false, radius = 28.0)
        var t = 0.0
        val seen = ArrayList<Double>()
        repeat(13) { seen += engine.step(t, 0.5, true, cfg, 340.0, 100.0).presence; t += 0.05 }
        assertEquals(0.0022719478738, seen[0], eps)
        assertEquals(0.0342935528121, seen[1], eps)
        assertEquals(0.541623799726, seen[6], eps)
        assertEquals(0.991083676269, seen[11], eps)
        assertEquals(1.0, seen[12], 0.0)

        val out = ArrayList<Double>()
        val visible = ArrayList<Boolean>()
        repeat(11) { out += engine.step(t, 0.5, false, cfg, 340.0, 100.0).presence; visible += engine.isVisible; t += 0.05 }
        assertEquals(0.972, out[0], eps)
        assertEquals(0.5, out[4], eps)
        assertEquals(0.028, out[8], eps)
        assertTrue(visible[8])
        assertEquals(0.0, out[9], 1e-30)
        assertFalse(visible[9])
        assertEquals(0.0, out[10], 0.0)
        assertFalse(visible[10])
    }

    @Test
    fun theEngineIsNotVisibleUntilItIsActiveAndStaysHiddenAtRest() {
        val engine = VoiceGlowEngine()
        assertFalse(engine.isVisible)
        engine.step(0.0, 0.0, false, config(), 340.0, 100.0)
        assertFalse(engine.isVisible)
        engine.step(0.05, 0.0, true, config(), 340.0, 100.0)
        assertTrue(engine.isVisible)
    }

    @Test
    fun aGapInTheClockIsCappedToFiftyMillisecondsAndARestartedClockStepsOneSixtieth() {
        val cfg = config()
        val gap = VoiceGlowEngine().apply { step(0.0, 0.5, true, cfg, 340.0, 100.0) }
        val fifty = VoiceGlowEngine().apply { step(0.0, 0.5, true, cfg, 340.0, 100.0) }
        assertEquals(
            fifty.step(0.05, 0.5, true, cfg, 340.0, 100.0).presence,
            gap.step(30.0, 0.5, true, cfg, 340.0, 100.0).presence,
            0.0,
        )

        val restarted = VoiceGlowEngine().apply { step(0.0, 0.5, true, cfg, 340.0, 100.0) }
        val steady = VoiceGlowEngine().apply { step(0.0, 0.5, true, cfg, 340.0, 100.0) }
        restarted.restartClock()
        assertEquals(
            steady.step(1.0 / 60, 0.5, true, cfg, 340.0, 100.0).presence,
            restarted.step(500.0, 0.5, true, cfg, 340.0, 100.0).presence,
            0.0,
        )
    }

    @Test
    fun aMobileGlowOnTheLightThemeFlowsSidewaysAcrossAWiderSpan() {
        val engine = VoiceGlowEngine()
        val cfg = config(VoiceGlowType.MOBILE, dark = false, variant = VoiceGlowColorVariant.OCEAN, radius = 55.0)
        engine.step(5.0, 0.8, true, cfg, 390.0, 120.0)
        engine.step(5.05, 0.8, true, cfg, 390.0, 120.0)
        val f = engine.step(5.1, 0.8, true, cfg, 390.0, 120.0)
        assertEquals(0.288351535213, f.level, eps)
        assertEquals(0.0987225651577, f.presence, eps)
        assertEquals(1.58419655032, f.h, eps)
        assertEquals(1.01262948255, f.w, eps)
        assertEquals(31.6223993842, f.lift, eps)
        assertEquals(2.48916527864, f.lobeX[0], eps)
        assertEquals(-179.760834721, f.lobeX[5], eps)
        assertEquals(184.739165279, f.lobeX[6], eps)
        assertEquals(0.0f, f.colors[0], 0f)
        assertEquals(0.5399543, f.colors[1].toDouble(), colorEps)
        assertEquals(0.8654212, f.colors[2].toDouble(), colorEps)
    }

    @Test
    fun reducedMotionHoldsTheLobesStillAndTheMonoColoursStatic() {
        val engine = VoiceGlowEngine()
        val cfg = config(VoiceGlowType.PILL, variant = VoiceGlowColorVariant.MONO, radius = 22.0, reduced = true)
        engine.step(0.0, 0.3, true, cfg, 150.0, 44.0)
        val f = engine.step(0.05, 0.3, true, cfg, 150.0, 44.0)
        assertEquals(0.113243672208, f.level, eps)
        assertEquals(0.760619851307, f.h, eps)
        assertEquals(1.99808552669, f.lift, eps)
        assertArray(doubleArrayOf(0.0, -7.29, 7.29, -14.58, 14.58, -21.87, 21.87), f.lobeX)
        assertEquals(0.680006108201, f.lobeL[0], eps)
        assertEquals(1.0f, f.colors[0], 0f)
        assertEquals(0.9529412, f.colors[3].toDouble(), colorEps)
    }

    @Test
    fun aGatheredBeamIsNarrowedMovedAndLiftedOntoTheCornerArcs() {
        val gathered = VoiceGlowMotion(gather = 0.7, offset = 0.5, stretch = 0.5, heldLevel = 0.6, cornerFollow = 0.8)
        val engine = VoiceGlowEngine()
        engine.step(0.0, 0.4, true, config(), 340.0, 100.0, gathered)
        val f = engine.step(0.05, 0.4, true, config(), 340.0, 100.0, gathered)
        assertEquals(0.48048, f.glow, eps)
        assertEquals(1.3903552, f.w, eps)
        assertEquals(53.55, f.cx, eps)
        assertEquals(0.685, f.maskWidth, eps)
        assertEquals(23.328, f.lift, eps)
        assertEquals(0.7216128, f.lobeX[0], eps)
        assertEquals(-17.0263872, f.lobeX[1], eps)

        val cornered = VoiceGlowMotion(gather = 1.0, offset = -0.9, heldLevel = 0.5, cornerFollow = 1.0)
        val narrow = VoiceGlowEngine()
        narrow.step(0.0, 0.4, true, config(), 120.0, 100.0, cornered)
        val g = narrow.step(0.05, 0.4, true, config(), 120.0, 100.0, cornered)
        assertEquals(-96.39, g.cx, eps)
        assertEquals(-26.0, g.cy, eps)
        for (y in g.lobeY) assertEquals(-26.0, y, eps)
        assertEquals(0.55, g.maskWidth, eps)
    }
}
