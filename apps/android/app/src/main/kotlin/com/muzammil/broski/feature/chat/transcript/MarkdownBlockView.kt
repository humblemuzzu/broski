package com.muzammil.broski.feature.chat.transcript

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.code.CodeBlock
import com.muzammil.broski.design.mono
import uniffi.broski_core.BlockContainer
import uniffi.broski_core.BlockContent
import uniffi.broski_core.ColumnAlignment
import uniffi.broski_core.ListMarker
import uniffi.broski_core.MarkdownBlock
import uniffi.broski_core.TableRow

private val INDENT = 22.dp
private val QUOTE_BAR = 3.dp

/**
 * One block of the agent's words as the core laid it out: indented by the quotes and list items
 * around it (a bar per quote, the marker on an item's first block), then its content.
 */
@Composable
fun MarkdownBlockView(block: MarkdownBlock, modifier: Modifier = Modifier) {
    val quoteColor = MaterialTheme.colorScheme.outlineVariant
    val quotes = block.containers.count { it is BlockContainer.Quote }
    Row(
        modifier.drawBehind {
            var x = 0f
            block.containers.forEach { container ->
                if (container is BlockContainer.Quote) drawRect(quoteColor, Offset(x, 0f), Size(QUOTE_BAR.toPx(), size.height))
                x += INDENT.toPx()
            }
        },
    ) {
        block.containers.forEach { container ->
            Box(Modifier.width(INDENT)) {
                if (container is BlockContainer.ListItem && container.first) Marker(container.marker)
            }
        }
        Box(Modifier.weight(1f)) { BlockContentView(block.content, quoted = quotes > 0) }
    }
}

@Composable
private fun Marker(marker: ListMarker) {
    val text = when (marker) {
        ListMarker.Bullet -> "•"
        is ListMarker.Number -> "${marker.value}."
        is ListMarker.Task -> if (marker.checked) "☑" else "☐"
    }
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.End,
        modifier = Modifier.padding(end = 6.dp),
    )
}

@Composable
private fun BlockContentView(content: BlockContent, quoted: Boolean) {
    val color = if (quoted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
    when (content) {
        is BlockContent.Paragraph -> SelectionContainer {
            Text(rememberInlineText(content.runs), style = PageStyle.body(), color = color)
        }
        is BlockContent.Heading -> SelectionContainer {
            Text(
                rememberInlineText(content.runs),
                style = PageStyle.heading(content.level.toInt()),
                modifier = Modifier.semantics { heading() },
            )
        }
        is BlockContent.Code -> CodeBlock(content.text, content.language)
        is BlockContent.Table -> MarkdownTable(content)
        BlockContent.Rule -> HorizontalDivider(Modifier.padding(vertical = 8.dp))
        is BlockContent.Html -> Text(content.text, style = MaterialTheme.typography.bodyMedium.mono(), color = color)
    }
}

/** The page's type: body 16 on generous leading, headings a step or two up and never shouting. */
object PageStyle {
    @Composable
    fun body(): TextStyle = MaterialTheme.typography.bodyLarge.copy(lineHeight = MaterialTheme.typography.bodyLarge.fontSize * 1.5f)

    @Composable
    fun heading(level: Int): TextStyle = when (level) {
        1 -> MaterialTheme.typography.titleLarge
        2 -> MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
        else -> MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
    }
}

/** A table that scrolls sideways; each column as wide as its widest cell, cells on one line. */
@Composable
private fun MarkdownTable(table: BlockContent.Table) {
    val rows = listOf(table.header) + table.rows
    val columns = rows.maxOf { it.cells.size }
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
            repeat(columns) { column ->
                TableColumn(rows, column, table.alignments.getOrNull(column) ?: ColumnAlignment.LEADING)
            }
        }
    }
}

@Composable
private fun TableColumn(rows: List<TableRow>, column: Int, alignment: ColumnAlignment) {
    val align = when (alignment) {
        ColumnAlignment.LEADING -> Alignment.Start
        ColumnAlignment.CENTER -> Alignment.CenterHorizontally
        ColumnAlignment.TRAILING -> Alignment.End
    }
    Column(Modifier.padding(horizontal = 12.dp), horizontalAlignment = align, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEachIndexed { index, row ->
            val runs = row.cells.getOrNull(column)?.runs.orEmpty()
            Text(
                rememberInlineText(runs),
                style = if (index == 0) MaterialTheme.typography.labelLarge else MaterialTheme.typography.bodyMedium,
                softWrap = false,
            )
        }
    }
}
