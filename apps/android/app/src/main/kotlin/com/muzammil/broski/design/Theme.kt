package com.muzammil.broski.design

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.Appearance

/** JetBrains Mono (variable): commands, paths, code and the terminal. */
val MonoFamily = FontFamily(
    Font(R.font.jetbrains_mono, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
    Font(R.font.jetbrains_mono, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.jetbrains_mono, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(700))),
)

private val BroskiTypography = Typography()

@Composable
fun isDarkTheme(appearance: Appearance): Boolean = when (appearance) {
    Appearance.System -> isSystemInDarkTheme()
    Appearance.Light -> false
    Appearance.Dark -> true
}

/**
 * Material 3 Expressive with the expressive motion scheme; dynamic colour from Android 12, the
 * brand's blue-violet scheme below it.
 */
@Composable
fun BroskiTheme(appearance: Appearance, content: @Composable () -> Unit) {
    val dark = isDarkTheme(appearance)
    val context = LocalContext.current
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> BroskiDarkColors
        else -> BroskiLightColors
    }
    CompositionLocalProvider(LocalSemanticColors provides if (dark) DarkSemanticColors else LightSemanticColors) {
        MaterialExpressiveTheme(
            colorScheme = colors,
            motionScheme = MotionScheme.expressive(),
            typography = BroskiTypography,
            content = content,
        )
    }
}

object BroskiTheme {
    val semantic: SemanticColors
        @Composable @ReadOnlyComposable
        get() = LocalSemanticColors.current
}

/** A text style in [MonoFamily], at the size and line height of `style`. */
fun TextStyle.mono(): TextStyle = copy(fontFamily = MonoFamily)
