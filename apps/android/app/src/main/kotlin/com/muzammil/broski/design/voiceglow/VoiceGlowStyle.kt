package com.muzammil.broski.design.voiceglow

/** One of the seven lobes: offset and size in dp for a reference host about 350 dp wide, and the band that drives it. */
internal class VoiceLobe(val x: Double, val w: Double, val h: Double, val band: Int)

/** The theme's own look; colours are packed `0xRRGGBB`. */
internal class ThemePreset(
    val strokeOpacity: Double,
    val innerOpacity: Double,
    val bloomOpacity: Double,
    val innerShadow: Int,
    val innerShadowAlpha: Double,
    val saturation: Double,
    val brightness: Double,
    val hueRange: Double,
    val hueDuration: Double,
    val hueBase: Double,
    val strength: Double,
)

/** The band's white core and its chromatic fringes above, between and below. */
internal class BandColors(val core: Int, val above: Int, val mid: Int, val below: Int)

internal object VoiceGlowStyle {
    /** The centre lobe follows the low band, its neighbours the mids, the outer pair the highs, the far pair the mids again. */
    val lobes = arrayOf(
        VoiceLobe(0.0, 74.0, 46.0, 0),
        VoiceLobe(-36.0, 54.0, 40.0, 1),
        VoiceLobe(36.0, 54.0, 40.0, 1),
        VoiceLobe(-72.0, 48.0, 32.0, 2),
        VoiceLobe(72.0, 48.0, 32.0, 2),
        VoiceLobe(-108.0, 42.0, 26.0, 1),
        VoiceLobe(108.0, 42.0, 26.0, 1),
    )

    const val LOBE_COUNT = 7
    private const val LOBE_SPACING = 36.0

    /** The ring the lobes travel around, one full turn of the flow. */
    const val LOBE_SPAN = LOBE_SPACING * LOBE_COUNT

    const val CEILING_HALF_WIDTH = 170.0
    const val CEILING_HEIGHT = 64.0
    const val BORDER_WIDTH = 1.0

    private val dark = ThemePreset(
        strokeOpacity = 1.16, innerOpacity = 0.47, bloomOpacity = 0.89,
        innerShadow = 0xFFFFFF, innerShadowAlpha = 0.1,
        saturation = 1.2, brightness = 1.1, hueRange = 24.0, hueDuration = 12.0, hueBase = 0.0, strength = 1.0,
    )
    private val light = ThemePreset(
        strokeOpacity = 1.2, innerOpacity = 0.85, bloomOpacity = 0.5,
        innerShadow = 0x000000, innerShadowAlpha = 0.08,
        saturation = 1.6, brightness = 0.95, hueRange = 40.0, hueDuration = 8.5, hueBase = 5.0, strength = 0.8,
    )

    fun themePreset(dark: Boolean): ThemePreset = if (dark) this.dark else light

    private val darkBand = BandColors(core = 0xFFFFFF, above = 0xFF4650, mid = 0x5AFF96, below = 0x508CFF)
    private val lightBand = BandColors(core = 0xC58BFF, above = 0xFF7AB6, mid = 0x7EC4FF, below = 0x2DFFAB)

    fun bandColors(dark: Boolean): BandColors = if (dark) darkBand else lightBand

    fun palette(variant: VoiceGlowColorVariant, dark: Boolean): IntArray {
        val p = palettes.getValue(variant)
        return if (dark) p.first else p.second
    }

    private val palettes: Map<VoiceGlowColorVariant, Pair<IntArray, IntArray>> = mapOf(
        VoiceGlowColorVariant.COLORFUL to (
            intArrayOf(0xFF4678, 0x3CBEFF, 0xAF46FF, 0x3CDC82, 0xFF9628, 0x5A64FF, 0x28C8BE) to
                intArrayOf(0xFFC915, 0x7EC4FF, 0xB428E6, 0xEB64A0, 0xFFB07A, 0x9AA0FF, 0x7FD9EE)
            ),
        VoiceGlowColorVariant.MONO to (
            intArrayOf(0xD7D7D7, 0xB4B4B4, 0xBEBEBE, 0xA0A0A0, 0xAAAAAA, 0x969696, 0x9B9B9B) to
                intArrayOf(0x3C3C3C, 0x5A5A5A, 0x555555, 0x6E6E6E, 0x696969, 0x7D7D7D, 0x787878)
            ),
        VoiceGlowColorVariant.OCEAN to (
            intArrayOf(0x508CFF, 0x28C8E6, 0x785AFF, 0x1EAAD2, 0xA050F0, 0x3C6EFF, 0x28BEB4) to
                intArrayOf(0x2864F0, 0x14A0C8, 0x5A3CE6, 0x1482B4, 0x8232DC, 0x2850E6, 0x149696)
            ),
        VoiceGlowColorVariant.SUNSET to (
            intArrayOf(0xFF6E3C, 0xFFB428, 0xFF3C5A, 0xFFD250, 0xF0468C, 0xFF8C32, 0xE6326E) to
                intArrayOf(0xEB501E, 0xE6960A, 0xE61E46, 0xE1AF1E, 0xD7286E, 0xEB6E14, 0xCD1E5A)
            ),
        VoiceGlowColorVariant.FOREST to (
            intArrayOf(0x46DC78, 0x28C8B4, 0x8CE650, 0x1EAA8C, 0xBEEB46, 0x32BE6E, 0x1E9678) to
                intArrayOf(0x1EAA50, 0x149682, 0x5AB41E, 0x148264, 0x82B414, 0x1E9650, 0x14785A)
            ),
        VoiceGlowColorVariant.CANDY to (
            intArrayOf(0xFF5AAA, 0xFF78DC, 0xD250FF, 0xFF96BE, 0xB46EFF, 0xFF468C, 0xE664F0) to
                intArrayOf(0xEB288C, 0xE646BE, 0xB428E6, 0xEB64A0, 0x9646E6, 0xE61E6E, 0xC83CD2)
            ),
        VoiceGlowColorVariant.ICE to (
            intArrayOf(0x96E6FF, 0x5AC8FF, 0xBEF0FF, 0x78BEFF, 0xA0DCFA, 0x50AAFF, 0xC8EBFF) to
                intArrayOf(0x1EA0DC, 0x1482D2, 0x3CB4E6, 0x2878DC, 0x32A0DC, 0x146EDC, 0x46AAE6)
            ),
        VoiceGlowColorVariant.GOLD to (
            intArrayOf(0xFFC846, 0xFFAA28, 0xFFDC6E, 0xF0961E, 0xFFEB8C, 0xE6A028, 0xFAD25A) to
                intArrayOf(0xC88C0A, 0xBE7800, 0xD2A01E, 0xB46E00, 0xCDAA28, 0xAF7305, 0xC39614)
            ),
    )
}
