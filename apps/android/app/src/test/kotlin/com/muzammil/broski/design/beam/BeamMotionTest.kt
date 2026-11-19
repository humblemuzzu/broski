package com.muzammil.broski.design.beam

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** The formulas of BorderBeamKit's `RotateBeamConfig`, `PulseDriver` and `BeamColorMatrix`, with values worked out from the Swift. */
class BeamMotionTest {
    private val delta = 1e-6

    @Test
    fun theBeamAngleIsTheFractionOfATurnAndWrapsEachDuration() {
        assertEquals(0.0, BeamMotion.beamAngle(0.0, 1.96), 0.0)
        assertEquals(0.5102040816326531, BeamMotion.beamAngle(1.0, 1.96), 1e-12)
        assertEquals(0.0, BeamMotion.beamAngle(1.96, 1.96), 0.0)
        assertEquals(0.5510204081632653, BeamMotion.beamAngle(5.0, 1.96), 1e-12)
        assertEquals(0.35714285714285765, BeamMotion.beamAngle(10.5, 1.96), 1e-12)
    }

    @Test
    fun theHuePingPongsFromMinusToPlusRangeOverThePeriod() {
        assertEquals(-30.0, BeamMotion.hueShiftDegrees(0.0, 30.0, 12.0, false), delta)
        assertEquals(-25.98076211353316, BeamMotion.hueShiftDegrees(1.0, 30.0, 12.0, false), delta)
        assertEquals(0.0, BeamMotion.hueShiftDegrees(3.0, 30.0, 12.0, false), delta)
        assertEquals(30.0, BeamMotion.hueShiftDegrees(6.0, 30.0, 12.0, false), delta)
        assertEquals(0.0, BeamMotion.hueShiftDegrees(9.0, 30.0, 12.0, false), delta)
        assertEquals(-30.0, BeamMotion.hueShiftDegrees(12.0, 30.0, 12.0, false), delta)
        assertEquals(7.76457135307561, BeamMotion.hueShiftDegrees(15.5, 30.0, 12.0, false), delta)
        assertEquals(0.0, BeamMotion.hueShiftDegrees(6.0, 30.0, 12.0, true), 0.0)
    }

    @Test
    fun pingPongIsZeroAtTheEndsAndOneInTheMiddle() {
        assertEquals(0.0, BeamMotion.pingPong(0.0), 0.0)
        assertEquals(1.0, BeamMotion.pingPong(0.5), 1e-15)
        assertEquals(0.5, BeamMotion.pingPong(0.25), 1e-15)
        assertEquals(0.0, BeamMotion.pingPong(1.0), 1e-15)
    }

    @Test
    fun theComposedMatrixIsSaturateAfterBrightnessAfterHueRotate() {
        assertMatrix(
            doubleArrayOf(1.173969149, -0.594071785, 0.720102637, 0.100649519, 1.423827845, -0.224477363, -0.624750481, 0.521328215, 1.403422267),
            composed(30.0, 1.3, 1.2),
        )
        assertMatrix(
            doubleArrayOf(1.81155, -0.46475, -0.0468, -0.13845, 1.48525, -0.0468, -0.13845, -0.46475, 1.9032),
            composed(0.0, 1.3, 1.5),
        )
        assertMatrix(
            doubleArrayOf(2.121075303, 0.316731097, -1.1378064, -0.321944142, 1.342880542, 0.2790636, 0.766155858, -1.356368903, 1.890213045),
            composed(-30.0, 1.3, 1.8),
        )
        assertMatrix(
            doubleArrayOf(0.93524332, -0.137805969, 0.202562649, 0.035999815, 1.023545908, -0.059545723, -0.165289026, 0.171702679, 0.993586347),
            composed(12.5, 1.0, 1.0),
        )
    }

    @Test
    fun noHueNoBrightnessNoSaturationChangeIsTheIdentity() {
        assertArrayEquals(BeamColorMatrix.identity(), composed(0.0, 1.0, 1.0).map { Math.round(it * 1e5f) / 1e5f }.toFloatArray(), 1e-4f)
    }

    @Test
    fun aReusedScratchGivesTheSameMatrixAsAFreshOne() {
        val scratch = BeamColorMatrix.Scratch()
        val reused = FloatArray(9)
        BeamColorMatrix.composed(10.0, 1.0, 1.0, reused, scratch)
        BeamColorMatrix.composed(30.0, 1.3, 1.2, reused, scratch)
        assertArrayEquals(composed(30.0, 1.3, 1.2), reused, 0f)
    }

    private fun composed(hue: Double, brightness: Double, saturation: Double): FloatArray {
        val out = FloatArray(9)
        BeamColorMatrix.composed(hue, brightness, saturation, out)
        return out
    }

    private fun assertMatrix(expected: DoubleArray, actual: FloatArray) {
        for (i in 0 until 9) assertEquals("entry $i", expected[i], actual[i].toDouble(), 1e-5)
    }
}
