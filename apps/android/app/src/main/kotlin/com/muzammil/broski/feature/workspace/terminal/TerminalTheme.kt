package com.muzammil.broski.feature.workspace.terminal

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext

/** The terminal's own colours, which the whole screen around the grid takes too, so the bar over it and the grid read as one surface. */
class TerminalPalette(val background: Color, val foreground: Color, val cursor: Color) {
    companion object {
        private val Light = TerminalPalette(Color(0xFFFFFFFF), Color(0xFF1C1C1E), Color(0xFF5B5FC7))
        private val Dark = TerminalPalette(Color(0xFF111114), Color(0xFFF2F2F7), Color(0xFFC0C1FF))

        val current: TerminalPalette
            @Composable get() = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Dark else Light
    }
}

private const val PREFERENCES = "terminal"
private const val FONT_SIZE = "font_size"
const val DEFAULT_FONT_SIZE = 13f

/**
 * The font size a pinch chose, kept for the next terminal. It lives in its own preferences file: the
 * app's settings store is not reachable from a screen of the workspace.
 */
@Composable
fun rememberTerminalFontSize(): Pair<Float, (Float) -> Unit> {
    val preferences = LocalContext.current.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    var size by remember { mutableFloatStateOf(preferences.getFloat(FONT_SIZE, DEFAULT_FONT_SIZE).coerceIn(TerminalFontSizes)) }
    return size to { next ->
        size = next
        preferences.edit().putFloat(FONT_SIZE, next).apply()
    }
}
