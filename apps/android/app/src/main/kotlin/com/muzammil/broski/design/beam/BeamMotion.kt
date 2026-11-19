package com.muzammil.broski.design.beam

import kotlin.math.cos

/** The beam's per-frame values: the same formulas as BorderBeamKit's `RotateBeamConfig` and `PulseDriver`. */
object BeamMotion {
    /** Turns of the beam at [seconds], 0 up to 1 and then round again. */
    fun beamAngle(seconds: Double, duration: Double): Double = (seconds / duration) % 1.0

    /** Cosine ease-in-out factor in 0..1: 0 at phase 0 and 1, 1 at phase 0.5. */
    fun pingPong(phase: Double): Double = (1 - cos(2 * Math.PI * phase)) / 2

    /** The rotate family's hue shift: ±[hueRange] degrees ping-ponging over [period] seconds. */
    fun hueShiftDegrees(seconds: Double, hueRange: Double, period: Double, staticColors: Boolean): Double {
        if (staticColors) return 0.0
        return -hueRange + 2 * hueRange * pingPong(seconds / period)
    }
}
