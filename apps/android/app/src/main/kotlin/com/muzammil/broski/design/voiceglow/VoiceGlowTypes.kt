package com.muzammil.broski.design.voiceglow

/**
 * Host preset, retuning the glow's geometry for the view it wraps.
 *
 * [STANDARD] is a chat input or card, about 350 dp wide; [PILL] a small recording pill, glow pulled
 * in with a shallower bend; [MOBILE] the bottom of a phone screen, wider range and taller rise.
 */
enum class VoiceGlowType { STANDARD, PILL, MOBILE }

/** The theme the glow is tuned for; [AUTO] follows the app's own light or dark appearance. */
enum class VoiceGlowTheme { DARK, LIGHT, AUTO }

enum class VoiceGlowColorVariant { COLORFUL, MONO, OCEAN, SUNSET, FOREST, CANDY, ICE, GOLD }

/**
 * The glow's large-scale motion for one frame: how far its lobes are gathered into one beam (0 the
 * voice glow at rest, 1 fully gathered) and where that beam sits. [Rest] is the plain voice glow;
 * no caller of the modifier moves it.
 */
internal class VoiceGlowMotion(
    val gather: Double,
    val offset: Double = 0.0,
    val stretch: Double = 0.0,
    val heldLevel: Double = 0.0,
    val cornerFollow: Double = 0.0,
) {
    companion object {
        val Rest = VoiceGlowMotion(gather = 0.0)
    }
}
