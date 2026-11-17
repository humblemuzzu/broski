package com.muzammil.broski.design.format

import android.content.ClipData
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import kotlinx.coroutines.launch
import uniffi.broski_core.ColumnAlign
import uniffi.broski_core.FormatTable
import uniffi.broski_core.TableCell
import uniffi.broski_core.TableColumn
import uniffi.broski_core.tableCsv
import uniffi.broski_core.tableHtml
import uniffi.broski_core.tableMarkdown
import uniffi.broski_core.tableTsv

/**
 * A table in a rounded card: the header bold on a light fill, rules between rows, cells top-aligned
 * and numbers right-aligned in tabular digits. Its columns fit the width as [TableLayout] decides;
 * past twelve rows it shows ten and a button for the rest; Expand opens it whole; a long-press
 * copies it as TSV and HTML at once, so a paste keeps it a table.
 */
@Composable
fun FormatTable(table: FormatTable, streaming: Boolean) {
    var showsAll by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var grown by remember { mutableStateOf<List<Dp>>(emptyList()) }
    val rows = if (table.rows.size > FormatTokens.TABLE_FOLD_ROWS && !showsAll) FormatTokens.TABLE_SHOWN_ROWS else table.rows.size
    val styles = tableStyles()
    val measure = TableMeasure(rememberTextMeasurer(), styles.first, styles.second, LocalDensity.current)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val fitted = remember(table, maxWidth, styles) { TableLayout.fit(table, maxWidth, measure) }
        val layout = if (streaming && grown.size == fitted.widths.size) fitted.copy(widths = fitted.widths.zip(grown) { a, b -> maxOf(a, b) }) else fitted
        SideEffect { if (streaming) grown = layout.widths }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(FormatTokens.tableRadius))
                    .border(0.5.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(FormatTokens.tableRadius))
                    .combinedClickable(interactionSource = null, indication = null, onClick = {}, onLongClick = { menu = true }),
            ) {
                TableGrid(table, layout, rows, styles)
                TableMenu(table, menu, onDismiss = { menu = false }, onExpand = { viewing = true })
            }
            TableFooter(table, showsAll, onToggle = { showsAll = !showsAll }, onExpand = { viewing = true })
        }
    }
    if (viewing) TableViewer(table) { viewing = false }
}

/** The cell and header styles, 14 sp, the header semibold. */
@Composable
fun tableStyles(scale: Float = 1f): Pair<TextStyle, TextStyle> {
    val base = MaterialTheme.typography.bodyMedium
    val cell = base.copy(
        color = MaterialTheme.colorScheme.onSurface,
        fontSize = base.fontSize * scale,
        lineHeight = base.lineHeight * scale,
        fontFeatureSettings = "tnum",
    )
    return cell to cell.copy(fontWeight = FontWeight.SemiBold)
}

/**
 * The cells at the layout's widths. A scrolling table moves its columns together by one offset, the
 * first held still when the layout says so, so every row keeps one height.
 */
@Composable
fun TableGrid(table: FormatTable, layout: TableLayout, rows: Int, styles: Pair<TextStyle, TextStyle>, modifier: Modifier = Modifier) {
    val density = LocalDensity.current
    BoxWithConstraints(modifier) {
        val held = if (layout.sticky) 1 else 0
        val heldWidth = layout.widths.take(held).fold(0.dp) { a, b -> a + b }
        val reach = with(density) { (layout.widths.drop(held).fold(0.dp) { a, b -> a + b } - (maxWidth - heldWidth)).toPx().coerceAtLeast(0f) }
        var scrolled by remember(layout.sticky) { mutableFloatStateOf(0f) }
        val offset = scrolled.coerceIn(0f, reach)
        val scroll = rememberScrollableState { delta ->
            val next = (offset - delta).coerceIn(0f, reach)
            val used = offset - next
            scrolled = next
            used
        }
        val scrolling = if (layout.scrolls) Modifier.scrollable(scroll, Orientation.Horizontal) else Modifier
        Column(scrolling.fadeEnd(layout.scrolls && offset < reach, FormatTokens.tableEdgeFade)) {
            TableRow(table, table.header, 0, layout, held, { offset }, styles.second, Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh))
            for (index in 0 until minOf(rows, table.rows.size)) {
                Box(Modifier.fillMaxWidth().height(0.5.dp).background(MaterialTheme.colorScheme.outlineVariant))
                TableRow(table, table.rows[index], index + 1, layout, held, { offset }, styles.first)
            }
        }
    }
}

@Composable
private fun TableRow(
    table: FormatTable,
    cells: List<TableCell>,
    index: Int,
    layout: TableLayout,
    held: Int,
    offset: () -> Float,
    style: TextStyle,
    modifier: Modifier = Modifier,
) {
    val spoken = spokenRow(table, cells, index)
    Row(modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken; if (index == 0) heading() }) {
        for (column in 0 until held) TableCellText(cells[column], table.columns[column], layout.widths[column], style)
        Box(Modifier.weight(1f).clipToBounds()) {
            Row(Modifier.wrapContentWidth(Alignment.Start, unbounded = true).graphicsLayer { translationX = -offset() }) {
                for (column in held until cells.size) TableCellText(cells[column], table.columns[column], layout.widths[column], style)
            }
        }
    }
}

@Composable
fun TableCellText(cell: TableCell, column: TableColumn, width: Dp, style: TextStyle) {
    val text = rememberSpans(cell.spans, spanLook(style))
    val align = when (column.align) {
        ColumnAlign.CENTER -> TextAlign.Center
        ColumnAlign.END -> TextAlign.End
        ColumnAlign.AUTO -> if (column.numeric) TextAlign.End else TextAlign.Start
        ColumnAlign.START -> TextAlign.Start
    }
    Text(text, style = style.copy(textAlign = align), modifier = Modifier.width(width).padding(horizontal = FormatTokens.cellHorizontal, vertical = FormatTokens.cellVertical))
}

@Composable
private fun spokenRow(table: FormatTable, cells: List<TableCell>, index: Int): String {
    val values = cells.map { plain(it.spans) }
    if (index == 0) return stringResource(R.string.format_table_columns, values.joinToString(", "))
    val named = table.header.map { plain(it.spans) }.zip(values) { header, value -> "$header: $value" }.joinToString(", ")
    return stringResource(R.string.format_table_row, index, table.rows.size, named)
}

@Composable
private fun TableFooter(table: FormatTable, showsAll: Boolean, onToggle: () -> Unit, onExpand: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (table.rows.size > FormatTokens.TABLE_FOLD_ROWS) {
            TextButton(onClick = onToggle) {
                Text(
                    if (showsAll) stringResource(R.string.format_table_show_fewer) else stringResource(R.string.format_table_show_all, table.rows.size),
                    color = formatLink,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
        Box(Modifier.weight(1f))
        IconButton(onClick = onExpand, modifier = Modifier.size(36.dp)) {
            Icon(painterResource(R.drawable.ic_open_in_full), stringResource(R.string.format_expand), Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Copy as TSV and HTML together, or as Markdown or CSV; Expand; Share. */
@Composable
fun TableMenu(table: FormatTable, open: Boolean, onDismiss: () -> Unit, onExpand: () -> Unit) {
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    fun copy(clip: ClipData) {
        onDismiss()
        scope.launch { clipboard.setClipEntry(ClipEntry(clip)) }
    }
    DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
        DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_table)) }, onClick = { copy(ClipData.newHtmlText("table", tableTsv(table), tableHtml(table))) })
        DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_markdown)) }, onClick = { copy(ClipData.newPlainText("table", tableMarkdown(table))) })
        DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_csv)) }, onClick = { copy(ClipData.newPlainText("table", tableCsv(table))) })
        DropdownMenuItem(text = { Text(stringResource(R.string.format_expand)) }, onClick = {
            onDismiss()
            onExpand()
        })
        DropdownMenuItem(text = { Text(stringResource(R.string.format_share)) }, onClick = {
            onDismiss()
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, tableMarkdown(table))
            context.startActivity(Intent.createChooser(send, null))
        })
    }
}
