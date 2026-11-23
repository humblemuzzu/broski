package com.muzammil.broski.design.format

import android.content.ClipData
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.muzammil.broski.R
import kotlinx.coroutines.launch
import uniffi.broski_core.FormatTable
import uniffi.broski_core.TableCell
import uniffi.broski_core.tableCsv
import uniffi.broski_core.tableMarkdown
import uniffi.broski_core.tableTsv

/**
 * A table opened whole: it scrolls both ways with its header row and first column held still, a
 * pinch changes its text size (during the pinch what is drawn is scaled; when it ends the table is
 * measured again at the new size), it turns with the phone, copies as Markdown, CSV or TSV, shares,
 * and can be read as rows instead, each a card of `Header: value`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TableViewer(table: FormatTable, onDone: () -> Unit) {
    var asRows by remember { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var pinch by remember { mutableFloatStateOf(1f) }
    Dialog(onDismissRequest = onDone, properties = FullScreenDialog) {
        Scaffold(
            contentWindowInsets = WindowInsets.safeDrawing,
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.format_table_title, table.rows.size, table.columns.size)) },
                    navigationIcon = { TextButton(onClick = onDone) { Text(stringResource(R.string.format_done)) } },
                    actions = { ViewerActions(table, asRows) { asRows = !asRows } },
                )
            },
        ) { padding ->
            val transform = rememberTransformableState { _: Offset, change: Float, _: Offset, _: Float ->
                pinch = (zoom * pinch * change).coerceIn(MIN_ZOOM, MAX_ZOOM) / zoom
            }
            LaunchedEffect(transform) {
                snapshotFlow { transform.isTransformInProgress }.collect { moving ->
                    if (!moving && pinch != 1f) {
                        zoom *= pinch
                        pinch = 1f
                    }
                }
            }
            val scaled = Modifier.graphicsLayer {
                scaleX = pinch
                scaleY = pinch
                transformOrigin = TransformOrigin(0f, 0f)
            }
            Box(Modifier.padding(padding).fillMaxSize()) {
                if (asRows) RowCards(table) else ViewerGrid(table, zoom, Modifier.fillMaxSize().transformable(transform).then(scaled))
            }
        }
    }
}

@Composable
private fun ViewerActions(table: FormatTable, asRows: Boolean, onToggle: () -> Unit) {
    var copying by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    fun copy(text: String) {
        copying = false
        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("table", text))) }
    }
    TextButton(onClick = onToggle) { Text(stringResource(if (asRows) R.string.format_table_grid else R.string.format_table_rows)) }
    Box {
        IconButton(onClick = { copying = true }) { Icon(painterResource(R.drawable.ic_content_copy), stringResource(R.string.format_copy)) }
        DropdownMenu(expanded = copying, onDismissRequest = { copying = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_markdown)) }, onClick = { copy(tableMarkdown(table)) })
            DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_csv)) }, onClick = { copy(tableCsv(table)) })
            DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_tsv)) }, onClick = { copy(tableTsv(table)) })
        }
    }
    IconButton(onClick = {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, tableMarkdown(table))
        context.startActivity(Intent.createChooser(send, null))
    }) { Icon(painterResource(R.drawable.ic_share), stringResource(R.string.format_share)) }
}

/** Every row lazily, the header pinned, the first column held while the rest move together. */
@Composable
private fun ViewerGrid(table: FormatTable, zoom: Float, modifier: Modifier) {
    val styles = tableStyles(zoom)
    val measure = TableMeasure(rememberTextMeasurer(), styles.first, styles.second, LocalDensity.current)
    val widths = remember(table, styles) {
        val (natural, minimum) = TableLayout.columnWidths(table, measure)
        natural.zip(minimum) { a, b -> maxOf(minOf(a, MAX_COLUMN * zoom), b) }
    }
    val density = LocalDensity.current
    BoxWithConstraints(modifier) {
        val reach = with(density) { (widths.drop(1).fold(0.dp) { a, b -> a + b } - (maxWidth - widths[0])).toPx().coerceAtLeast(0f) }
        var offset by remember(widths) { mutableFloatStateOf(0f) }
        val scroll = rememberScrollableState { delta ->
            val next = (offset - delta).coerceIn(0f, reach)
            val used = offset - next
            offset = next
            used
        }
        LazyColumn(Modifier.fillMaxSize().scrollable(scroll, Orientation.Horizontal)) {
            stickyHeader { ViewerRow(table, table.header, widths, { offset }, styles.second, header = true) }
            items(table.rows.size) { index -> ViewerRow(table, table.rows[index], widths, { offset }, styles.first, header = false) }
        }
    }
}

@Composable
private fun ViewerRow(table: FormatTable, cells: List<TableCell>, widths: List<Dp>, offset: () -> Float, style: TextStyle, header: Boolean) {
    val fill = if (header) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surface
    Column(Modifier.background(fill)) {
        Row(Modifier.fillMaxWidth()) {
            Box(Modifier.background(fill)) { TableCellText(cells[0], table.columns[0], widths[0], style, header = header) }
            Box(Modifier.weight(1f).clipToBounds()) {
                Row(Modifier.wrapContentWidth(Alignment.Start, unbounded = true).graphicsLayer { translationX = -offset() }) {
                    for (column in 1 until cells.size) TableCellText(cells[column], table.columns[column], widths[column], style, header = header)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(MaterialTheme.colorScheme.outlineVariant))
    }
}

/** Each row as a card of `Header: value`, for a table too wide to read as a grid. */
@Composable
private fun RowCards(table: FormatTable) {
    val headers = remember(table) { table.header.map { plain(it.spans) } }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(table.rows.size) { index ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    table.rows[index].forEachIndexed { column, cell ->
                        Text(headers[column], style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        val style = MaterialTheme.typography.bodyLarge
                        val look = spanLook(style)
                        SpanText(rememberSpans(cell.spans, look), style, codeSize = look.codeSize)
                    }
                }
            }
        }
    }
}

private val MAX_COLUMN = 320.dp
private const val MIN_ZOOM = 0.6f
private const val MAX_ZOOM = 2.2f
