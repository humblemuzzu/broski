package com.muzammil.broski.design.voiceglow

/**
 * One frame's driven values, written in place by [VoiceGlowEngine.step]: what the web driver writes
 * as CSS custom properties, plus the lobe colours the stylesheet leaves to its filter.
 */
internal class VoiceGlowFrame {
    var level = 0.0

    /** Presence of the whole effect, 0–1 (the fade in and out), smoothed. */
    var presence = 0.0

    /** `--vb-glow`: layer opacity factor. */
    var glow = 0.4

    /** `--vb-h` / `--vb-w`: height and spread multipliers. */
    var h = 0.8
    var w = 1.0

    /** `--vb-cx` / `--vb-cy`: the beam's sideways travel and its corner lift, dp. */
    var cx = 0.0
    var cy = 0.0

    /** `--vb-mw`: the range narrowed into a beam while gathered. */
    var maskWidth = 1.0

    /** `--vb-bh` / `--vb-bendA`: the ceiling's extra height and the band's strength. */
    var lift = 0.0
    var bendA = 0.0

    /** How far the lobes are gathered into one beam, 0–1. */
    var morph = 0.0

    /** Per lobe: offset along the flow (`--vb-xN`), amplitude (`--vb-lN`), corner lift (`--vb-yN`). */
    val lobeX = DoubleArray(VoiceGlowStyle.LOBE_COUNT)
    val lobeL = DoubleArray(VoiceGlowStyle.LOBE_COUNT) { 1.0 }
    val lobeY = DoubleArray(VoiceGlowStyle.LOBE_COUNT)

    /** Lobe colours after the hue / brightness / saturate chain, r, g, b per lobe in 0–1. */
    val colors = FloatArray(VoiceGlowStyle.LOBE_COUNT * 3)

    /** The chain itself, a row-major 3×3, for the highlight and the band. */
    val colorMatrix = DoubleArray(9)
}
