package com.muzammil.broski.design.voiceglow

/** Everything the engine and the layers need, resolved from the type preset, the theme and the caller's choices. */
internal class VoiceGlowConfig(
    val type: VoiceGlowType,
    val dark: Boolean,
    val colorVariant: VoiceGlowColorVariant,
    val cornerRadius: Double,
    val reducedMotion: Boolean,
) {
    val g: VoiceGeometry = VoiceGeometry.resolve(type, dark).scaled()
    val theme: ThemePreset = VoiceGlowStyle.themePreset(dark)

    val idle = g.idle.coerceIn(0.0, 1.0)
    val strength = (g.strength ?: theme.strength).coerceIn(0.0, 1.0)
    val brightness = g.brightness ?: theme.brightness
    val saturation = g.saturation ?: theme.saturation
    val hueRange = maxOf(0.0, theme.hueRange)
    val hueDuration = maxOf(0.5, theme.hueDuration)
    val staticColors = colorVariant == VoiceGlowColorVariant.MONO

    /** The variant's seven colours, packed `0xRRGGBB`. */
    val baseColors: IntArray = VoiceGlowStyle.palette(colorVariant, dark)

    companion object {
        /** Input gain is not applied on this path: the level arrives already 0…1. */
        const val THRESHOLD = 0.015
        const val ATTACK = 0.325
        const val RELEASE = 0.86
        const val BREATHE_DURATION = 5.2
    }
}
