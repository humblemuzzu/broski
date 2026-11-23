package com.muzammil.broski.design.format

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.ReadingSettings
import uniffi.broski_core.CalloutKind
import uniffi.broski_core.FormatSpacing

object FormatTokens {
    val readableWidth = 680.dp
    val quoteBarWidth = 2.5.dp
    val quoteGap = 10.dp
    val calloutRadius = 10.dp
    val calloutBarWidth = 3.dp
    val calloutPadding = 12.dp

    /** Diminishing per-level list indents (depths 1, 2, 3+); capped at 36 dp so nested lists keep width. */
    val listIndentSteps = listOf(14f, 12f, 10f)
    val bulletBoxWidth = 8.dp
    val bulletGap = 8.dp
    val numberGap = 6.dp
    val taskGutter = 16.dp
    val taskGap = 7.dp
    val codeSize = 13.5.sp
    const val INLINE_CODE_SCALE = 0.87f
    val inlineCodeRadius = 5.dp
    val codeRadius = 12.dp
    const val CODE_FOLD_LINES = 30
    const val CODE_COUNT_LINES = 10
    val tableRadius = 10.dp
    val cellHorizontal = 10.dp
    val cellVertical = 8.5.dp
    val tableMinColumn = 56.dp
    val tableMaxMinColumn = 192.dp
    val tableScrollColumn = 236.dp
    val tableEdgeFade = 28.dp
    const val MENU_LINKS = 5
    const val TABLE_FOLD_ROWS = 12
    const val TABLE_SHOWN_ROWS = 10
    const val KEY_COLUMN_SHARE = 0.4f
    const val ARRIVAL_MS = 150

    val linkLight = Color(0xFF1D4ED8)
    val linkDark = Color(0xFF60A5FA)
    val pathLight = Color(0xFF0F766E)
    val pathDark = Color(0xFF7CC7BC)

    fun listBaseIndentDp(depth: Int, fontScale: Float = 1f): Dp {
        val clamped = depth.coerceIn(0, listIndentSteps.size)
        var sum = 0f
        for (i in 0 until clamped) sum += listIndentSteps[i]
        return (sum * fontScale.coerceIn(0.85f, 1.35f)).dp
    }

    fun spacing(step: FormatSpacing, quiet: Boolean = false, compact: Boolean = false): Dp {
        val points = when (step) {
            FormatSpacing.NONE -> 0f
            FormatSpacing.TIGHT -> 6f
            FormatSpacing.AFTER_HEADING -> 7f
            FormatSpacing.LEAD_IN -> 8f
            FormatSpacing.STACKED_HEADING -> 10f
            FormatSpacing.LOOSE, FormatSpacing.AFTER_GROUP -> 12f
            FormatSpacing.PARAGRAPH -> 14f
            FormatSpacing.BLOCK -> 16f
            FormatSpacing.RULE -> 18f
            FormatSpacing.SUB_SECTION -> 20f
            FormatSpacing.SECTION -> 26f
        }
        return (points * (if (quiet) 0.75f else 1f) * (if (compact) 0.78f else 1f)).dp
    }
}

private val isDarkSurface: Boolean
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.surface.luminance() < 0.5f

val formatLink: Color
    @Composable @ReadOnlyComposable
    get() = if (isDarkSurface) FormatTokens.linkDark else FormatTokens.linkLight

val formatPath: Color
    @Composable @ReadOnlyComposable
    get() = if (isDarkSurface) FormatTokens.pathDark else FormatTokens.pathLight

val formatCodeFill: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.09f else 0.055f)

val formatCodeBorder: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.11f else 0.075f)

val formatPathFill: Color
    @Composable @ReadOnlyComposable
    get() = formatPath.copy(alpha = if (isDarkSurface) 0.13f else 0.09f)

val formatPathBorder: Color
    @Composable @ReadOnlyComposable
    get() = formatPath.copy(alpha = if (isDarkSurface) 0.22f else 0.18f)

val formatCardBorder: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.10f else 0.08f)

val formatRuleColor: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.12f else 0.10f)

val formatListGuide: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.10f else 0.08f)

val formatMarkerColor: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.48f else 0.45f)

val formatTableHeaderFill: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.045f else 0.03f)

val formatTableRowHairline: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.09f else 0.08f)

val formatTableHeaderHairline: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (isDarkSurface) 0.18f else 0.16f)

val LocalFormatBleed = staticCompositionLocalOf { 0.dp }
val LocalInQuote = staticCompositionLocalOf { false }

enum class FormatRole {
    Page,
    Quiet,
    ;

    @Composable
    fun textStyle(): TextStyle {
        val type = MaterialTheme.typography
        return if (this == Page) type.bodyLarge.copy(fontSize = 16.sp, lineHeight = 23.5.sp) else type.bodyMedium.copy(fontSize = 14.5.sp, lineHeight = 20.5.sp)
    }

    @Composable
    fun headingStyle(level: UByte): TextStyle {
        val body = textStyle()
        return when {
            this == Quiet -> body.copy(fontWeight = FontWeight.SemiBold, fontSize = if (level == 1.toUByte()) 15.5.sp else 14.5.sp, lineHeight = 20.sp)
            level == 1.toUByte() -> body.copy(fontSize = 22.sp, lineHeight = 27.sp, letterSpacing = (-0.35).sp, fontWeight = FontWeight.SemiBold)
            level == 2.toUByte() -> body.copy(fontSize = 19.sp, lineHeight = 24.sp, letterSpacing = (-0.25).sp, fontWeight = FontWeight.SemiBold)
            level == 3.toUByte() -> body.copy(fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = (-0.15).sp, fontWeight = FontWeight.SemiBold)
            else -> body.copy(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold)
        }
    }

    @Composable
    fun color(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant

    @Composable
    fun bodyColor(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.88f) else color()

    @Composable
    fun boldColor(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.97f) else Color.Unspecified

    @Composable
    fun quoteColor(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f) else color()

    @Composable
    fun linesHeight(lines: Int): Dp = with(LocalDensity.current) { (textStyle().lineHeight * lines).toDp() }
}

val LocalReading = staticCompositionLocalOf { ReadingSettings() }
val LocalSetReading = staticCompositionLocalOf<(ReadingSettings) -> Unit> { {} }

@Composable
fun ReadingTextSize(content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val steps = LocalReading.current.sizeSteps
    if (steps == 0) {
        content()
    } else {
        CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * (1f + SIZE_STEP * steps)), content = content)
    }
}

private const val SIZE_STEP = 0.12f

@Composable
fun CalloutKind.tint(): Color {
    val dark = isDarkSurface
    return when (this) {
        CalloutKind.NOTE -> if (dark) Color(0xFF4493F8) else Color(0xFF0969DA)
        CalloutKind.TIP -> if (dark) Color(0xFF3FB950) else Color(0xFF1A7F37)
        CalloutKind.IMPORTANT -> if (dark) Color(0xFFAB7DF8) else Color(0xFF8250DF)
        CalloutKind.WARNING -> if (dark) Color(0xFFD29922) else Color(0xFF9A6700)
        CalloutKind.CAUTION -> if (dark) Color(0xFFF85149) else Color(0xFFCF222E)
        CalloutKind.INSIGHT -> if (dark) Color(0xFFF0883E) else Color(0xFFBC4C00)
    }
}

@get:DrawableRes
val CalloutKind.icon: Int
    get() = when (this) {
        CalloutKind.NOTE -> R.drawable.ic_info
        CalloutKind.TIP -> R.drawable.ic_lightbulb
        CalloutKind.IMPORTANT -> R.drawable.ic_announcement
        CalloutKind.WARNING -> R.drawable.ic_warning
        CalloutKind.CAUTION -> R.drawable.ic_report
        CalloutKind.INSIGHT -> R.drawable.ic_star
    }

@get:StringRes
val CalloutKind.title: Int
    get() = when (this) {
        CalloutKind.NOTE -> R.string.format_callout_note
        CalloutKind.TIP -> R.string.format_callout_tip
        CalloutKind.IMPORTANT -> R.string.format_callout_important
        CalloutKind.WARNING -> R.string.format_callout_warning
        CalloutKind.CAUTION -> R.string.format_callout_caution
        CalloutKind.INSIGHT -> R.string.format_callout_insight
    }
