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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.mono
import uniffi.broski_core.DiffFile
import uniffi.broski_core.DiffSegment
import uniffi.broski_core.TokenKind

/** From this width a diff shows old and new side by side (Material's expanded window width). */
private val SIDE_BY_SIDE_WIDTH = 840.dp

/**
 * A file's diff as the core parsed it: its path and counts, then its hunks, unified on a phone and
 * side by side on a wide window; added and removed lines tinted and edged, the words that changed
 * in them tinted more strongly, both line numbers in the gutter. [header] goes above the file's.
 */
@Composable
fun DiffView(
    file: DiffFile,
    wrap: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    header: LazyListScope.() -> Unit = {},
) {
    val colors = CodeColors.current
    BoxWithConstraints(modifier) {
        val fileHeader: LazyListScope.() -> Unit = {
            header()
            item(key = "file") { DiffFileHeader(file) }
        }
        if (maxWidth >= SIDE_BY_SIDE_WIDTH) {
            SideBySideDiff(file, colors, contentPadding, fileHeader)
        } else {
            val lines = remember(file, colors) { unifiedLines(diffRows(file), colors) }
            CodeLines(lines, MaterialTheme.typography.bodySmall.mono(), wrap, Modifier, contentPadding, fileHeader)
        }
    }
}

private fun unifiedLines(rows: List<DiffRow>, colors: CodeColors): List<ViewerLine> = rows.map { row ->
    val accent = row.kind.accent(colors)
    val text = segmentedText(row.text, row.segments, colors, accent?.let(colors::wordTint))
    when (row.kind) {
        DiffRowKind.Hunk -> ViewerLine(text, row.gutter, colors.hunk)
        else -> ViewerLine(text, row.gutter, accent?.let(colors::lineTint), accent)
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

@Composable
fun DiffFileHeader(file: DiffFile, modifier: Modifier = Modifier) {
    val colors = CodeColors.current
    val style = MaterialTheme.typography.labelLarge.mono()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(painterResource(R.drawable.ic_draft), contentDescription = null, modifier = Modifier.size(18.dp))
        Text(file.path, style = style, maxLines = 1, overflow = TextOverflow.StartEllipsis, modifier = Modifier.weight(1f))
        Text("−${file.deletions}", style = style, color = colors.removed)
        Text("+${file.additions}", style = style, color = colors.added)
    }
}
