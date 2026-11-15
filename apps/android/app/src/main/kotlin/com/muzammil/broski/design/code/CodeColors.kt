package com.muzammil.broski.design.code

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.material3.MaterialTheme
import com.muzammil.broski.design.BroskiTheme
import uniffi.broski_core.TokenKind

/**
 * How the app colours what the core's `highlight` names, and a diff's lines. The token colours are
 * GitHub's light and dark syntax palettes (Primer), which hold AA contrast on the surfaces code sits on.
 */
@Immutable
class CodeColors(
    private val tokens: Map<TokenKind, Color>,
    val plain: Color,
    val gutter: Color,
    val added: Color,
    val removed: Color,
    val hunk: Color,
) {
    fun of(kind: TokenKind): Color = tokens[kind] ?: plain

    /** The tint of a whole added or removed line, and the stronger one of its changed words. */
    fun lineTint(accent: Color): Color = accent.copy(alpha = LINE_ALPHA)

    fun wordTint(accent: Color): Color = accent.copy(alpha = WORD_ALPHA)

    companion object {
        /** The scheme in effect: dark when its surface is. */
        val current: CodeColors
            @Composable @ReadOnlyComposable
            get() {
                val scheme = MaterialTheme.colorScheme
                val dark = scheme.surface.luminance() < 0.5f
                return CodeColors(
                    tokens = if (dark) DarkTokens else LightTokens,
                    plain = scheme.onSurface,
                    gutter = scheme.onSurfaceVariant.copy(alpha = GUTTER_ALPHA),
                    added = BroskiTheme.semantic.done,
                    removed = scheme.error,
                    hunk = scheme.primary.copy(alpha = HUNK_ALPHA),
                )
            }
    }
}

private const val LINE_ALPHA = 0.14f
private const val WORD_ALPHA = 0.34f
private const val GUTTER_ALPHA = 0.7f
private const val HUNK_ALPHA = 0.08f

private val LightTokens = mapOf(
    TokenKind.COMMENT to Color(0xFF6E7781),
    TokenKind.KEYWORD to Color(0xFFCF222E),
    TokenKind.STRING to Color(0xFF0A3069),
    TokenKind.NUMBER to Color(0xFF0550AE),
    TokenKind.CONSTANT to Color(0xFF0550AE),
    TokenKind.TYPE to Color(0xFF953800),
    TokenKind.FUNCTION to Color(0xFF8250DF),
    TokenKind.VARIABLE to Color(0xFF953800),
    TokenKind.PROPERTY to Color(0xFF0550AE),
    TokenKind.TAG to Color(0xFF116329),
    TokenKind.ATTRIBUTE to Color(0xFF0550AE),
    TokenKind.INSERTED to Color(0xFF116329),
    TokenKind.DELETED to Color(0xFF82071E),
    TokenKind.HEADING to Color(0xFF0550AE),
)

private val DarkTokens = mapOf(
    TokenKind.COMMENT to Color(0xFF8B949E),
    TokenKind.KEYWORD to Color(0xFFFF7B72),
    TokenKind.STRING to Color(0xFFA5D6FF),
    TokenKind.NUMBER to Color(0xFF79C0FF),
    TokenKind.CONSTANT to Color(0xFF79C0FF),
    TokenKind.TYPE to Color(0xFFFFA657),
    TokenKind.FUNCTION to Color(0xFFD2A8FF),
    TokenKind.VARIABLE to Color(0xFFFFA657),
    TokenKind.PROPERTY to Color(0xFF79C0FF),
    TokenKind.TAG to Color(0xFF7EE787),
    TokenKind.ATTRIBUTE to Color(0xFF79C0FF),
    TokenKind.INSERTED to Color(0xFFAFF5B4),
    TokenKind.DELETED to Color(0xFFFFDCD7),
    TokenKind.HEADING to Color(0xFF79C0FF),
)
