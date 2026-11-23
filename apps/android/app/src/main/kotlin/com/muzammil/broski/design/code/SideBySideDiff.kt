package com.muzammil.broski.design.code

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import uniffi.broski_core.DiffFile
import uniffi.broski_core.DiffLine
import uniffi.broski_core.sideBySide

private sealed interface SideRow {
    data class Hunk(val text: String) : SideRow

    data class Pair(val left: DiffLine?, val right: DiffLine?) : SideRow
}

private fun sideRows(file: DiffFile): List<SideRow> = file.hunks.flatMap { hunk ->
    listOf(SideRow.Hunk(hunkHeader(hunk))) + sideBySide(hunk).map { SideRow.Pair(it.left, it.right) }
}

private val DIVIDER = 0.5.dp

/** Old on the left, new on the right, each line folding to its half, as the core's `sideBySide` pairs them. */
@Composable
internal fun SideBySideDiff(
    file: DiffFile,
    colors: CodeColors,
    contentPadding: PaddingValues,
    header: LazyListScope.() -> Unit,
    footer: LazyListScope.() -> Unit,
) {
    val rows = remember(file) { sideRows(file) }
    val width = remember(file) { numberWidth(file) }
    val style = CodeTextStyle
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val gutter = remember(style, width) {
        with(density) { measurer.measure("0".repeat(width), style).size.width.toDp() } + 12.dp
    }
    SelectionContainer {
        LazyColumn(contentPadding = contentPadding) {
            header()
            items(rows, contentType = { it::class }) { row ->
                when (row) {
                    is SideRow.Hunk -> Text(
                        row.text,
                        style = style,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        modifier = Modifier.fillMaxWidth().background(colors.hunk).padding(horizontal = 12.dp, vertical = 4.dp),
                    )
                    is SideRow.Pair -> Row(Modifier.height(IntrinsicSize.Min)) {
                        Half(row.left, isOld = true, width, gutter, colors, Modifier.weight(1f))
                        Box(Modifier.width(DIVIDER).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant))
                        Half(row.right, isOld = false, width, gutter, colors, Modifier.weight(1f))
                    }
                }
            }
            footer()
        }
    }
}

@Composable
private fun Half(line: DiffLine?, isOld: Boolean, width: Int, gutter: Dp, colors: CodeColors, modifier: Modifier) {
    val accent = line?.rowKind?.accent(colors)
    val fill = when {
        accent != null -> colors.lineTint(accent)
        line == null -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.05f)
        else -> null
    }
    Row(modifier.fillMaxHeight().then(if (fill != null) Modifier.background(fill) else Modifier).padding(vertical = 1.dp)) {
        Text(
            number(if (isOld) line?.oldLine else line?.newLine, width),
            style = CodeTextStyle,
            color = colors.gutter,
            textAlign = TextAlign.End,
            modifier = Modifier.width(gutter).padding(end = 8.dp),
        )
        if (line?.rowKind == DiffRowKind.NoNewline) {
            Text(stringResource(R.string.diff_no_newline), style = CodeTextStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 12.dp))
        } else if (line != null) {
            Text(segmentedText(line.text, line.segments, colors, accent?.let(colors::wordTint)), style = CodeTextStyle, modifier = Modifier.padding(end = 12.dp))
        }
    }
}
