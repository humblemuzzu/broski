package com.muzammil.broski.design.voiceglow

import org.junit.Assert.assertEquals
import org.junit.Test

/** The engine's helpers against the numbers VoiceGlowKit's Swift `VoiceGlowEngine` gives for the same inputs. */
class VoiceGlowEngineMathTest {
    private val eps = 1e-9

    @Test
    fun shapeGatesNoiseAndRoundsOffAShout() {
        assertEquals(0.0, VoiceGlowEngine.shape(0.01, 0.015), 0.0)
        assertEquals(0.0, VoiceGlowEngine.shape(0.015, 0.015), 0.0)
        assertEquals(0.812148807308, VoiceGlowEngine.shape(0.5, 0.015), eps)
        assertEquals(0.462101751068, VoiceGlowEngine.shape(0.2, 0.009), eps)
        assertEquals(1.0, VoiceGlowEngine.shape(1.0, 0.015), eps)
    }

    @Test
    fun followRisesAtTheAttackAndFallsAtTheRelease() {
        assertEquals(0.133627005339, VoiceGlowEngine.follow(0.1, 0.8, 0.016, 0.325, 0.86), eps)
        assertEquals(0.787097142937, VoiceGlowEngine.follow(0.8, 0.1, 0.016, 0.325, 0.86), eps)
        assertEquals(0.4, VoiceGlowEngine.follow(0.4, 0.4, 0.016, 0.325, 0.86), 0.0)
    }

    @Test
    fun wrapXFoldsAnOffsetIntoHalfASpanEitherSide() {
        assertEquals(70.0, VoiceGlowEngine.wrapX(70.0, 252.0), eps)
        assertEquals(52.0, VoiceGlowEngine.wrapX(-200.0, 252.0), eps)
        assertEquals(-122.0, VoiceGlowEngine.wrapX(130.0, 252.0), eps)
        assertEquals(-126.0, VoiceGlowEngine.wrapX(-126.0, 252.0), eps)
        assertEquals(-126.0, VoiceGlowEngine.wrapX(126.0, 252.0), eps)
    }

    @Test
    fun edgeEnvelopeIsFullAtTheCentreAndGoneBeyondTheWrapEdge() {
        assertEquals(1.0, VoiceGlowEngine.edgeEnvelope(0.0, 252.0), eps)
        assertEquals(0.765147928994, VoiceGlowEngine.edgeEnvelope(63.0, 252.0), eps)
        assertEquals(0.0605917159763, VoiceGlowEngine.edgeEnvelope(-126.0, 252.0), eps)
        assertEquals(0.0, VoiceGlowEngine.edgeEnvelope(200.0, 252.0), eps)
    }

    @Test
    fun pingPongIsACosineBetweenZeroAndOne() {
        assertEquals(0.0, VoiceGlowEngine.pingPong(0.0), eps)
        assertEquals(0.5, VoiceGlowEngine.pingPong(0.25), eps)
        assertEquals(1.0, VoiceGlowEngine.pingPong(0.5), eps)
        assertEquals(0.654508497187, VoiceGlowEngine.pingPong(1.3), eps)
    }

    @Test
    fun paintedRadiusIsClampedToHalfTheBox() {
        assertEquals(28.0, VoiceGlowEngine.paintedRadius(28.0, 340.0, 100.0), 0.0)
        assertEquals(50.0, VoiceGlowEngine.paintedRadius(80.0, 340.0, 100.0), 0.0)
        assertEquals(0.0, VoiceGlowEngine.paintedRadius(-3.0, 340.0, 100.0), 0.0)
    }

    @Test
    fun cornerLiftFollowsTheOutlineOfTheRoundedCorner() {
        assertEquals(6.55238941047, VoiceGlowEngine.cornerLift(10.0, 340.0, 28.0), eps)
        assertEquals(0.0, VoiceGlowEngine.cornerLift(300.0, 340.0, 28.0), 0.0)
        assertEquals(0.0, VoiceGlowEngine.cornerLift(170.0, 340.0, 28.0), 0.0)
        assertEquals(1.16718427, VoiceGlowEngine.cornerLift(40.0, 340.0, 28.0, 20.0), 1e-7)
        assertEquals(28.0, VoiceGlowEngine.cornerLift(5.0, 340.0, 28.0, 20.0), 0.0)
        assertEquals(0.0, VoiceGlowEngine.cornerLift(5.0, 340.0, 0.0, 20.0), 0.0)
    }

    @Test
    fun theBandBellIsOneAtTheCentreAndExactlyZeroAtTheEnds() {
        assertEquals(1.0, VoiceGlowBandPlan.bell(0.0, 1.75, 0.87, 0.12), eps)
        assertEquals(0.587917813212, VoiceGlowBandPlan.bell(0.5, 1.75, 0.87, 0.12), eps)
        assertEquals(0.526162262143, VoiceGlowBandPlan.bell(-0.5, 1.75, 0.87, 0.12), eps)
        assertEquals(0.0, VoiceGlowBandPlan.bell(1.0, 1.75, 0.87, 0.12), eps)
    }

    @Test
    fun theBandTailRisesOnlyPastItsStartPosition() {
        assertEquals(0.204813429274, VoiceGlowBandPlan.tailLift(150.0, 170.0, 0.59, 0.67, 2.4), eps)
        assertEquals(0.0, VoiceGlowBandPlan.tailLift(100.0, 170.0, 0.59, 0.67, 2.4), 0.0)
        assertEquals(0.0, VoiceGlowBandPlan.tailLift(150.0, 170.0, 0.0, 0.67, 2.4), 0.0)
    }
}
