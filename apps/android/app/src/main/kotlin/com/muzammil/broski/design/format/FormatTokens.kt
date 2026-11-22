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

/**
 * Every measure the formatter draws with, in one place; iOS's `FormatTokens.swift` holds the same
 * table so the two apps cannot drift.
 */
object FormatTokens {
    /** Prose wider than this reads badly; on a wide screen it is centred at this width. */
    val readableWidth = 680.dp
    val quoteBarWidth = 3.dp
    val quoteGap = 12.dp
    val calloutRadius = 12.dp
    val calloutPadding = 14.dp

    /** Lists indent no deeper than this, so a phone keeps its width. */
    const val MAX_LIST_INDENT = 4u
    val bulletGutter = 14.dp
    val markerGap = 6.dp
    val codeSize = 14.sp
    const val INLINE_CODE_SCALE = 0.88f
    val inlineCodeRadius = 4.dp
    val codeRadius = 12.dp

    /** A code block past this many lines folds; its header counts lines past [CODE_COUNT_LINES]. */
    const val CODE_FOLD_LINES = 30
    const val CODE_COUNT_LINES = 10
    val tableRadius = 12.dp
    val cellHorizontal = 10.dp
    val cellVertical = 10.dp
    val tableMinColumn = 56.dp
    val tableMaxMinColumn = 200.dp
    val tableScrollColumn = 240.dp

    /** The width over which a sideways-scrolling table fades while more of it is to the end. */
    val tableEdgeFade = 28.dp

    /** Links a long-pressed block offers by name. */
    const val MENU_LINKS = 5

    /** A table past [TABLE_FOLD_ROWS] rows shows [TABLE_SHOWN_ROWS] and a button for the rest. */
    const val TABLE_FOLD_ROWS = 12
    const val TABLE_SHOWN_ROWS = 10

    /** A key/value table's labels take at most this share of the width. */
    const val KEY_COLUMN_SHARE = 0.4f

    /** How long a new block takes to fade in while an answer streams. */
    const val ARRIVAL_MS = 150

    /** Links in one blue, never the scheme's primary or the wallpaper's colour, AA on either surface. */
    val linkLight = Color(0xFF1D4ED8)
    val linkDark = Color(0xFF60A5FA)

    /** A path the agent named in code: it opens the file, so not plain code, and it is no page, so not link blue. */
    val pathLight = Color(0xFF0F766E)
    val pathDark = Color(0xFF7CC7BC)

    /** The space before a block, by its step, for the answer's size; quiet text is tighter. */
    fun spacing(step: FormatSpacing, quiet: Boolean = false, compact: Boolean = false): Dp {
        val points = when (step) {
            FormatSpacing.NONE -> 0f
            FormatSpacing.TIGHT -> 8f
            FormatSpacing.LOOSE, FormatSpacing.AFTER_GROUP -> 14f
            FormatSpacing.AFTER_HEADING -> 10f
            FormatSpacing.PARAGRAPH -> 16f
            FormatSpacing.SECTION -> 28f
        }
        return (points * (if (quiet) 0.75f else 1f) * (if (compact) 0.75f else 1f)).dp
    }
}

/** The link blue for the surface in effect. */
val formatLink: Color
    @Composable @ReadOnlyComposable
    get() = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) FormatTokens.linkDark else FormatTokens.linkLight

/** The colour of a path that opens its file, for the surface in effect. */
val formatPath: Color
    @Composable @ReadOnlyComposable
    get() = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) FormatTokens.pathDark else FormatTokens.pathLight

/** Inline code's fill: the text's own colour, faint, so the code reads as part of its sentence. */
val formatCodeFill: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) 0.11f else 0.06f)

/**
 * The side margin of the screen the text is on: a code block or a table at the top level of an answer
 * reaches across it to the screen's edges. Zero where the text sits inside something else.
 */
val LocalFormatBleed = staticCompositionLocalOf { 0.dp }

/**
 * Where agent-authored text is drawn, which sets its size and emphasis: [Page] for the answer the
 * person reads (the transcript, a plan, a report opened whole), [Quiet] for what sits under a row
 * (thinking, a subagent's or an activity's text, a tool's report).
 */
enum class FormatRole {
    Page,
    Quiet,
    ;

    /** Body 16 sp on 24 sp lines; quiet 14 on 20. */
    @Composable
    fun textStyle(): TextStyle {
        val type = MaterialTheme.typography
        return if (this == Page) type.bodyLarge.copy(fontSize = 16.sp, lineHeight = 24.sp) else type.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp)
    }

    /** H1 23 sp bold, H2 20 semibold, H3 17 semibold, H4–H6 at body size semibold (drawn in the secondary colour). */
    @Composable
    fun headingStyle(level: UByte): TextStyle {
        val body = textStyle()
        return when {
            this == Quiet -> body.copy(fontWeight = FontWeight.SemiBold, fontSize = if (level == 1.toUByte()) 16.sp else 14.sp)
            level == 1.toUByte() -> body.copy(fontSize = 23.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold)
            level == 2.toUByte() -> body.copy(fontSize = 20.sp, lineHeight = 27.sp, fontWeight = FontWeight.SemiBold)
            level == 3.toUByte() -> body.copy(fontSize = 17.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
            else -> body.copy(fontWeight = FontWeight.SemiBold)
        }
    }

    @Composable
    fun color(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant

    /**
     * An answer's running text: a step softer than the full text colour, so long reading does not glare. Bold is a
     * little brighter than it ([boldColor]) and headings are at full strength.
     */
    @Composable
    fun bodyColor(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.86f) else color()

    /** Bold in running text: just above the body, found when scanning without pulling the eye while reading. */
    @Composable
    fun boldColor(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.94f) else Color.Unspecified

    /** The height of [lines] lines of this role's text at the font scale in effect, for a fold. */
    @Composable
    fun linesHeight(lines: Int): Dp = with(LocalDensity.current) { (textStyle().lineHeight * lines).toDp() }
}

/** Settings › Reading, as the formatter's composables read them. */
val LocalReading = staticCompositionLocalOf { ReadingSettings() }

/** Stores a change to Settings › Reading (a code block's Wrap button remembers the choice). */
val LocalSetReading = staticCompositionLocalOf<(ReadingSettings) -> Unit> { {} }

/** Agent text at the reader's chosen size: the phone's font scale moved by their steps. */
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

/** A callout's colour, icon and title by kind. */
@Composable
fun CalloutKind.tint(): Color {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
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
