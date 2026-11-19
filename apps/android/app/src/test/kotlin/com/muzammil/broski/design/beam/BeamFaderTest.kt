package com.muzammil.broski.design.beam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BeamFaderTest {
    @Test
    fun theEaseCurveIsCssEase() {
        assertEquals(0.0, BeamFader.cssEase(0.0), 0.0)
        assertEquals(0.09474762286672632, BeamFader.cssEase(0.1), 1e-9)
        assertEquals(0.4085476840126603, BeamFader.cssEase(0.25), 1e-9)
        assertEquals(0.8024179382287911, BeamFader.cssEase(0.5), 1e-9)
        assertEquals(0.9604396766021409, BeamFader.cssEase(0.75), 1e-9)
        assertEquals(0.9943190103831163, BeamFader.cssEase(0.9), 1e-9)
        assertEquals(1.0, BeamFader.cssEase(1.0), 0.0)
    }

    @Test
    fun aFreshFaderIsHiddenAndStaysSoUntilItIsToldOtherwise() {
        val fader = BeamFader(0.6, 0.5)
        assertEquals(0.0, fader.value(123.0), 0.0)
        assertTrue(fader.isHidden(123.0))
        fader.retarget(shown = false, seconds = 124.0)
        assertTrue(fader.isHidden(124.0))
    }

    @Test
    fun itFadesInOverPointSixSeconds() {
        val fader = BeamFader(0.6, 0.5)
        fader.retarget(shown = true, seconds = 10.0)
        assertEquals(0.0, fader.value(10.0), 0.0)
        assertEquals(BeamFader.cssEase(0.5), fader.value(10.3), 1e-12)
        assertEquals(1.0, fader.value(10.6), 0.0)
        assertEquals(1.0, fader.value(99.0), 0.0)
        assertFalse(fader.isHidden(99.0))
    }

    @Test
    fun itFadesOutOverPointFiveSecondsAndThenIsHidden() {
        val fader = BeamFader(0.6, 0.5)
        fader.retarget(shown = true, seconds = 0.0)
        fader.retarget(shown = false, seconds = 5.0)
        assertEquals(1.0, fader.value(5.0), 0.0)
        assertEquals(1.0 - BeamFader.cssEase(0.5), fader.value(5.25), 1e-12)
        assertFalse(fader.isHidden(5.49))
        assertEquals(0.0, fader.value(5.5), 0.0)
        assertTrue(fader.isHidden(5.5))
        assertTrue(fader.isHidden(50.0))
    }

    @Test
    fun aChangeOfMindMidFadeStartsFromWhereItHadGot() {
        val fader = BeamFader(0.6, 0.5)
        fader.retarget(shown = true, seconds = 0.0)
        val reached = fader.value(0.3)
        fader.retarget(shown = false, seconds = 0.3)
        assertEquals(reached, fader.value(0.3), 1e-12)
        fader.retarget(shown = true, seconds = 0.4)
        val back = fader.value(0.4)
        assertEquals(back, fader.value(0.4), 0.0)
        assertTrue(back < reached)
        assertEquals(1.0, fader.value(1.0), 0.0)
    }

    @Test
    fun retargetingToTheSameTargetChangesNothing() {
        val fader = BeamFader(0.6, 0.5)
        fader.retarget(shown = true, seconds = 0.0)
        val before = fader.value(0.3)
        fader.retarget(shown = true, seconds = 0.2)
        assertEquals(before, fader.value(0.3), 0.0)
    }
}
