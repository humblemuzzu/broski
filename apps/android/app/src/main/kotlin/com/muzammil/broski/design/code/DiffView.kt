package com.muzammil.broski.design.code

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.Grouped
import uniffi.broski_contract.GitChange
import uniffi.broski_core.DiffFile
import uniffi.broski_core.DiffSegment
import uniffi.broski_core.TokenKind

/** From this width a diff shows old and new side by side (Material's expanded window width). */
private val SIDE_BY_SIDE_WIDTH = 840.dp

private val HUNK_PADDING = 4.dp
private val LINE_PADDING = 1.dp

/**
 * A file's diff as the core parsed it: its path and counts, a note when there are no lines to
 * show, then its hunks, unified on a phone and side by side on a wide window; added and removed
 * lines tinted, the words that changed in them tinted more strongly, both line numbers in the
 * gutter. [header] goes above the file's.
 */
@Composable
fun DiffView(
    file: DiffFile,
    wrap: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    truncated: Boolean = false,
    header: LazyListScope.() -> Unit = {},
) {
    val colors = CodeColors.current
    val note = diffNote(file)
    BoxWithConstraints(modifier) {
        val fileHeader: LazyListScope.() -> Unit = {
            header()
            item(key = "file") { DiffFileHeader(file) }
            note?.let { item(key = "note") { DiffNote(it, CodeTextStyle.copy(fontFamily = null, fontSize = 15.sp, lineHeight = 20.sp)) } }
        }
        val footer: LazyListScope.() -> Unit = {
            if (truncated) item(key = "truncated") { DiffNote(stringResource(R.string.diff_truncated), CodeTextStyle.copy(fontFamily = null)) }
        }
        if (maxWidth >= SIDE_BY_SIDE_WIDTH) {
            SideBySideDiff(file, colors, contentPadding, fileHeader, footer)
        } else {
            val secondary = MaterialTheme.colorScheme.onSurfaceVariant
            val lines = remember(file, colors, secondary) { unifiedLines(diffRows(file), colors, secondary) }
            CodeLines(lines, CodeTextStyle, wrap, Modifier, contentPadding, fileHeader, footer = footer)
        }
    }
}

/** Why a file shows no lines, in a sentence; null when it has some. */
@Composable
private fun diffNote(file: DiffFile): String? = when {
    file.binary -> stringResource(R.string.diff_binary)
    file.change == GitChange.CONFLICTED -> stringResource(R.string.diff_conflicted)
    file.previousPath != null -> stringResource(R.string.diff_renamed, file.previousPath!!)
    file.hunks.isEmpty() -> stringResource(R.string.diff_no_lines)
    else -> null
}

@Composable
private fun DiffNote(text: String, style: TextStyle) {
    Text(text, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth().padding(16.dp))
}

private fun unifiedLines(rows: List<DiffRow>, colors: CodeColors, secondary: Color): List<ViewerLine> = rows.map { row ->
    val accent = row.kind.accent(colors)
    when (row.kind) {
        DiffRowKind.Hunk -> ViewerLine(styled(row.text, secondary), row.gutter, colors.hunk, verticalPadding = HUNK_PADDING)
        DiffRowKind.NoNewline -> ViewerLine(styled(row.text, secondary), row.gutter, verticalPadding = LINE_PADDING)
        else -> {
            val text = segmentedText(row.text, row.segments, colors, accent?.let(colors::wordTint))
            ViewerLine(signed(text, accent), row.gutter, accent?.let(colors::lineTint), verticalPadding = LINE_PADDING)
        }
    }
}

private fun styled(text: String, color: Color): AnnotatedString = buildAnnotatedString { withStyle(SpanStyle(color = color)) { append(text) } }

/** The sign takes the line's tint, so the numbers read without the colour of the row. */
private fun signed(text: AnnotatedString, accent: Color?): AnnotatedString {
    if (accent == null || text.isEmpty()) return text
    return buildAnnotatedString {
        append(text)
        addStyle(SpanStyle(color = accent), 0, 1)
    }
}

fun DiffRowKind.accent(colors: CodeColors): Color? = when (this) {
    DiffRowKind.Added -> colors.added
    DiffRowKind.Removed -> colors.removed
    else -> null
}

/** [text] with syntax foreground colours and changed-word background tint from [segments]. */
fun segmentedText(text: String, segments: List<DiffSegment>, colors: CodeColors, wordTint: Color?): AnnotatedString {
    if (segments.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        segments.forEach { segment ->
            val fg = if (segment.kind == TokenKind.PLAIN) Color.Unspecified else colors.of(segment.kind)
            val bg = if (segment.emphasized && wordTint != null) wordTint else Color.Unspecified
            if (fg == Color.Unspecified && bg == Color.Unspecified) {
                append(segment.text)
            } else {
                withStyle(SpanStyle(color = fg, background = bg)) { append(segment.text) }
            }
        }
    }
}

/** The file's path, with lines added then removed, signed so the numbers read without their colour. */
@Composable
fun DiffFileHeader(file: DiffFile, modifier: Modifier = Modifier) {
    val colors = CodeColors.current
    val style = CodeTextStyle.copy(fontWeight = FontWeight.Medium)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Grouped.card)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(painterResource(R.drawable.ic_description), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        Text(file.path, style = style, maxLines = 1, overflow = TextOverflow.StartEllipsis, modifier = Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (file.additions > 0) Text("+${file.additions}", style = style.copy(fontFeatureSettings = "tnum"), color = colors.added)
            if (file.deletions > 0) Text("−${file.deletions}", style = style.copy(fontFeatureSettings = "tnum"), color = colors.removed)
        }
    }
}
