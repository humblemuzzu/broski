package com.muzammil.broski.design

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Broski's own schemes, used unless the person turns on the wallpaper's colours: ink on neutral
// greys with no hue of their own, so colour is left to what it means (SemanticColors). The primary
// is near black in light and near white in dark, its "on" colour the opposite.

internal val BroskiLightColors = lightColorScheme(
    primary = Color(0xFF1C1C1E),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE5E5EA),
    onPrimaryContainer = Color(0xFF1C1C1E),
    inversePrimary = Color(0xFFE5E5EA),
    secondary = Color(0xFF48484A),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE9E9EE),
    onSecondaryContainer = Color(0xFF1C1C1E),
    tertiary = Color(0xFF48484A),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE9E9EE),
    onTertiaryContainer = Color(0xFF1C1C1E),
    background = Color(0xFFFCFCFD),
    onBackground = Color(0xFF1C1C1E),
    surface = Color(0xFFFCFCFD),
    onSurface = Color(0xFF1C1C1E),
    surfaceVariant = Color(0xFFE5E5EA),
    onSurfaceVariant = Color(0xFF5E5E63),
    surfaceTint = Color(0xFF1C1C1E),
    inverseSurface = Color(0xFF2C2C2E),
    inverseOnSurface = Color(0xFFF2F2F7),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    outline = Color(0xFF8E8E93),
    outlineVariant = Color(0xFFD1D1D6),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFFCFCFD),
    surfaceContainer = Color(0xFFF2F2F5),
    surfaceContainerHigh = Color(0xFFECECEF),
    surfaceContainerHighest = Color(0xFFE5E5EA),
    surfaceContainerLow = Color(0xFFF7F7F8),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceDim = Color(0xFFDCDCDF),
    primaryFixed = Color(0xFFE5E5EA),
    primaryFixedDim = Color(0xFFC7C7CC),
    onPrimaryFixed = Color(0xFF1C1C1E),
    onPrimaryFixedVariant = Color(0xFF48484A),
    secondaryFixed = Color(0xFFE5E5EA),
    secondaryFixedDim = Color(0xFFC7C7CC),
    onSecondaryFixed = Color(0xFF1C1C1E),
    onSecondaryFixedVariant = Color(0xFF48484A),
    tertiaryFixed = Color(0xFFE5E5EA),
    tertiaryFixedDim = Color(0xFFC7C7CC),
    onTertiaryFixed = Color(0xFF1C1C1E),
    onTertiaryFixedVariant = Color(0xFF48484A),
)

internal val BroskiDarkColors = darkColorScheme(
    primary = Color(0xFFF2F2F7),
    onPrimary = Color(0xFF1C1C1E),
    primaryContainer = Color(0xFF3A3A3C),
    onPrimaryContainer = Color(0xFFF2F2F7),
    inversePrimary = Color(0xFF1C1C1E),
    secondary = Color(0xFFC7C7CC),
    onSecondary = Color(0xFF1C1C1E),
    secondaryContainer = Color(0xFF2C2C2E),
    onSecondaryContainer = Color(0xFFF2F2F7),
    tertiary = Color(0xFFC7C7CC),
    onTertiary = Color(0xFF1C1C1E),
    tertiaryContainer = Color(0xFF2C2C2E),
    onTertiaryContainer = Color(0xFFF2F2F7),
    background = Color(0xFF000000),
    onBackground = Color(0xFFF5F5F7),
    surface = Color(0xFF000000),
    onSurface = Color(0xFFF5F5F7),
    surfaceVariant = Color(0xFF2C2C2E),
    onSurfaceVariant = Color(0xFFAEAEB2),
    surfaceTint = Color(0xFFF5F5F7),
    inverseSurface = Color(0xFFE5E5EA),
    inverseOnSurface = Color(0xFF1C1C1E),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF8E8E93),
    outlineVariant = Color(0xFF3A3A3C),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF242426),
    surfaceContainer = Color(0xFF111113),
    surfaceContainerHigh = Color(0xFF1C1C1E),
    surfaceContainerHighest = Color(0xFF262629),
    surfaceContainerLow = Color(0xFF0B0B0D),
    surfaceContainerLowest = Color(0xFF000000),
    surfaceDim = Color(0xFF000000),
    primaryFixed = Color(0xFFE5E5EA),
    primaryFixedDim = Color(0xFFC7C7CC),
    onPrimaryFixed = Color(0xFF1C1C1E),
    onPrimaryFixedVariant = Color(0xFF48484A),
    secondaryFixed = Color(0xFFE5E5EA),
    secondaryFixedDim = Color(0xFFC7C7CC),
    onSecondaryFixed = Color(0xFF1C1C1E),
    onSecondaryFixedVariant = Color(0xFF48484A),
    tertiaryFixed = Color(0xFFE5E5EA),
    tertiaryFixedDim = Color(0xFFC7C7CC),
    onTertiaryFixed = Color(0xFF1C1C1E),
    onTertiaryFixedVariant = Color(0xFF48484A),
)

/**
 * The colours that carry meaning, the same with or without the wallpaper's colours: needs you in
 * orange, done in green, failed in the scheme's error; work in progress stays neutral beside its orb.
 * Highlight is the one blue, for a line or row picked out in code, diffs and git. Each keeps AA
 * contrast on the schemes' surfaces.
 */
@Immutable
data class SemanticColors(
    val needsYou: Color,
    val working: Color,
    val done: Color,
    val caution: Color,
    val highlight: Color,
)

internal val LightSemanticColors = SemanticColors(
    needsYou = Color(0xFFB45309),
    working = Color(0xFF5E5E63),
    done = Color(0xFF15803D),
    caution = Color(0xFFB45309),
    highlight = Color(0xFF1D4ED8),
)
internal val DarkSemanticColors = SemanticColors(
    needsYou = Color(0xFFFF9F0A),
    working = Color(0xFFAEAEB2),
    done = Color(0xFF30D158),
    caution = Color(0xFFFF9F0A),
    highlight = Color(0xFF60A5FA),
)

internal val LocalSemanticColors = staticCompositionLocalOf { LightSemanticColors }
