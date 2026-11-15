package com.muzammil.broski.design

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// The fallback schemes below Android 12, where there is no dynamic colour: Material's tonal-spot
// scheme for the brand's blue-violet seed #5B5FC7 (material-color-utilities 0.4.0, SchemeTonalSpot).

internal val BroskiLightColors = lightColorScheme(
    primary = Color(0xFF575992),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE1E0FF),
    onPrimaryContainer = Color(0xFF3F4178),
    inversePrimary = Color(0xFFC0C1FF),
    secondary = Color(0xFF5D5D72),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE2E0F9),
    onSecondaryContainer = Color(0xFF454559),
    tertiary = Color(0xFF79536A),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFD8ED),
    onTertiaryContainer = Color(0xFF5F3C52),
    background = Color(0xFFFCF8FF),
    onBackground = Color(0xFF1B1B21),
    surface = Color(0xFFFCF8FF),
    onSurface = Color(0xFF1B1B21),
    surfaceVariant = Color(0xFFE4E1EC),
    onSurfaceVariant = Color(0xFF46464F),
    surfaceTint = Color(0xFF575992),
    inverseSurface = Color(0xFF303036),
    inverseOnSurface = Color(0xFFF3EFF7),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    outline = Color(0xFF777680),
    outlineVariant = Color(0xFFC7C5D0),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFFCF8FF),
    surfaceContainer = Color(0xFFF0ECF4),
    surfaceContainerHigh = Color(0xFFEAE7EF),
    surfaceContainerHighest = Color(0xFFE4E1E9),
    surfaceContainerLow = Color(0xFFF6F2FA),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceDim = Color(0xFFDCD9E0),
    primaryFixed = Color(0xFFE1E0FF),
    primaryFixedDim = Color(0xFFC0C1FF),
    onPrimaryFixed = Color(0xFF12144B),
    onPrimaryFixedVariant = Color(0xFF3F4178),
    secondaryFixed = Color(0xFFE2E0F9),
    secondaryFixedDim = Color(0xFFC5C4DD),
    onSecondaryFixed = Color(0xFF191A2C),
    onSecondaryFixedVariant = Color(0xFF454559),
    tertiaryFixed = Color(0xFFFFD8ED),
    tertiaryFixedDim = Color(0xFFE8B9D4),
    onTertiaryFixed = Color(0xFF2E1125),
    onTertiaryFixedVariant = Color(0xFF5F3C52),
)

internal val BroskiDarkColors = darkColorScheme(
    primary = Color(0xFFC0C1FF),
    onPrimary = Color(0xFF282A60),
    primaryContainer = Color(0xFF3F4178),
    onPrimaryContainer = Color(0xFFE1E0FF),
    inversePrimary = Color(0xFF575992),
    secondary = Color(0xFFC5C4DD),
    onSecondary = Color(0xFF2E2F42),
    secondaryContainer = Color(0xFF454559),
    onSecondaryContainer = Color(0xFFE2E0F9),
    tertiary = Color(0xFFE8B9D4),
    onTertiary = Color(0xFF46263B),
    tertiaryContainer = Color(0xFF5F3C52),
    onTertiaryContainer = Color(0xFFFFD8ED),
    background = Color(0xFF131318),
    onBackground = Color(0xFFE4E1E9),
    surface = Color(0xFF131318),
    onSurface = Color(0xFFE4E1E9),
    surfaceVariant = Color(0xFF46464F),
    onSurfaceVariant = Color(0xFFC7C5D0),
    surfaceTint = Color(0xFFC0C1FF),
    inverseSurface = Color(0xFFE4E1E9),
    inverseOnSurface = Color(0xFF303036),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF918F9A),
    outlineVariant = Color(0xFF46464F),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF39383F),
    surfaceContainer = Color(0xFF1F1F25),
    surfaceContainerHigh = Color(0xFF2A292F),
    surfaceContainerHighest = Color(0xFF35343A),
    surfaceContainerLow = Color(0xFF1B1B21),
    surfaceContainerLowest = Color(0xFF0E0E13),
    surfaceDim = Color(0xFF131318),
    primaryFixed = Color(0xFFE1E0FF),
    primaryFixedDim = Color(0xFFC0C1FF),
    onPrimaryFixed = Color(0xFF12144B),
    onPrimaryFixedVariant = Color(0xFF3F4178),
    secondaryFixed = Color(0xFFE2E0F9),
    secondaryFixedDim = Color(0xFFC5C4DD),
    onSecondaryFixed = Color(0xFF191A2C),
    onSecondaryFixedVariant = Color(0xFF454559),
    tertiaryFixed = Color(0xFFFFD8ED),
    tertiaryFixedDim = Color(0xFFE8B9D4),
    onTertiaryFixed = Color(0xFF2E1125),
    onTertiaryFixedVariant = Color(0xFF5F3C52),
)

/**
 * The colours that carry meaning beyond the scheme: working is blue and done green on every
 * device; needs you is the scheme's primary and failed its error. Tones 40 (light) and 80 (dark)
 * of material-color-utilities tonal palettes from #1F6FEB and #2DA44E, which keep AA contrast on
 * the scheme's surfaces.
 */
@Immutable
data class SemanticColors(val working: Color, val done: Color)

internal val LightSemanticColors = SemanticColors(working = Color(0xFF0059C8), done = Color(0xFF006E2C))
internal val DarkSemanticColors = SemanticColors(working = Color(0xFFAFC6FF), done = Color(0xFF6BDE80))

internal val LocalSemanticColors = staticCompositionLocalOf { LightSemanticColors }
