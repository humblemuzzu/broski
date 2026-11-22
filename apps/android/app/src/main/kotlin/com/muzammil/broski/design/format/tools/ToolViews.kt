package com.muzammil.broski.design.format.tools

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.code.highlightedLines
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.exceeds
import com.muzammil.broski.design.format.formatLink
import com.muzammil.broski.design.format.formatPath
import com.muzammil.broski.design.format.rememberSpans
import com.muzammil.broski.design.format.spanLook
import com.muzammil.broski.design.mono
import uniffi.broski_core.CodeLine
import uniffi.broski_core.LogLine
import uniffi.broski_core.MatchRow
import uniffi.broski_core.TokenKind
import uniffi.broski_core.ToolBody
import uniffi.broski_core.languageForPath

/** What a tool's result opens: a file at a line, or a long text on a sheet of its own. */
class ToolLinks(
    val openFile: (path: String, line: Int?) -> Unit,
    val openReport: (title: String, text: String) -> Unit,
    val openLog: (title: String, text: String) -> Unit,
)

private val OUTPUT_MAX = 220.dp

/** Blocks of a report drawn in place; the rest opens on a sheet of its own. */
private const val REPORT_BLOCKS = 6
private const val FILE_LINES = 24

/**
 * A tool's result as the core reads it (`toolBody`): markdown formatted, a file's numbered lines,
 * search rows that open their files, JSON coloured, or a log with its links found. Everything a
 * tool printed is drawn here or by the formatter, never raw.
 */
@Composable
fun ToolBodyView(body: ToolBody, title: String, source: String, links: ToolLinks) {
    when (body) {
        ToolBody.Empty -> Unit
        is ToolBody.Markdown -> ReportBody(body.text, title, links)
        is ToolBody.FileText -> FileTextBody(body.path, body.language, body.firstLine.toInt(), body.text, null, links)
        is ToolBody.Matches -> MatchRows(body.rows, body.hiddenRows.toInt(), links)
        is ToolBody.Json -> CodeBox(body.lines)
        is ToolBody.Log -> LogBox(body.lines, body.hiddenLines.toInt(), title, source, links)
    }
}

/** A report or a fetched page: its first blocks formatted, the whole a tap away. */
@Composable
fun ReportBody(text: String, title: String, links: ToolLinks) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FormattedText(text, role = FormatRole.Quiet, limit = REPORT_BLOCKS)
        if (exceeds(text, REPORT_BLOCKS)) {
            TextButton(onClick = { links.openReport(title, text) }) { Text(stringResource(R.string.format_open_report), color = formatLink) }
        }
    }
}

/** Lines of a file from the line they start at, coloured by its language; the first in place, the file in Files. */
@Composable
fun FileTextBody(path: String, language: String?, firstLine: Int, text: String, note: String?, links: ToolLinks) {
    val trimmed = remember(text) { text.removeSuffix("\n") }
    val coloured = highlightedLines(trimmed, language ?: remember(path) { languageForPath(path) }, CodeColors.current)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        NumberedCode(coloured.take(FILE_LINES), firstLine)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            note?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (coloured.size > FILE_LINES) {
                val more = coloured.size - FILE_LINES
                Text(pluralStringResource(R.plurals.format_more_lines, more, more), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        TextButton(onClick = { links.openFile(path, firstLine) }) { Text(stringResource(R.string.format_open_in_files), color = formatLink) }
    }
}

@Composable
private fun NumberedCode(lines: List<AnnotatedString>, firstLine: Int) {
    val style = MaterialTheme.typography.bodySmall.mono()
    val gutter = CodeColors.current.gutter
    val numbered = remember(lines, firstLine, gutter) {
        val width = (firstLine + lines.size).toString().length
        buildAnnotatedString {
            lines.forEachIndexed { index, line ->
                if (index > 0) append('\n')
                withStyle(SpanStyle(color = gutter)) { append((firstLine + index).toString().padStart(width) + "  ") }
                append(line)
            }
        }
    }
    CodeSurface { Text(numbered, style = style, softWrap = false, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(8.dp)) }
}

@Composable
private fun CodeSurface(content: @Composable () -> Unit) {
    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.fillMaxWidth()) { content() }
}

/** Coloured code lines (pretty-printed JSON) in a capped box that scrolls both ways. */
@Composable
fun CodeBox(lines: List<CodeLine>) {
    val colors = CodeColors.current
    val text = remember(lines, colors) {
        buildAnnotatedString {
            lines.forEachIndexed { index, line ->
                if (index > 0) append('\n')
                line.spans.forEach { span ->
                    if (span.kind == TokenKind.PLAIN) append(span.text) else withStyle(SpanStyle(color = colors.of(span.kind))) { append(span.text) }
                }
            }
        }
    }
    CodeSurface {
        SelectionContainer {
            Text(text, style = MaterialTheme.typography.bodySmall.mono(), softWrap = false, modifier = Modifier.heightIn(max = OUTPUT_MAX).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(8.dp))
        }
    }
}

/** Search results: a row per file, or per matching line, opening the file at it. */
@Composable
fun MatchRows(rows: List<MatchRow>, hidden: Int, links: ToolLinks) {
    val mark = BroskiTheme.semantic.highlight.copy(alpha = 0.22f)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { row ->
            Column(Modifier.fillMaxWidth().clickable { links.openFile(row.path, row.line?.toInt()) }) {
                Text(row.path + (row.line?.let { ":$it" } ?: ""), style = MaterialTheme.typography.bodySmall.mono().copy(fontWeight = FontWeight.Medium), color = formatPath, maxLines = 1, overflow = TextOverflow.StartEllipsis)
                if (row.segments.isNotEmpty()) {
                    val text = remember(row, mark) {
                        buildAnnotatedString {
                            row.segments.forEach { segment ->
                                if (segment.matched) withStyle(SpanStyle(background = mark, fontWeight = FontWeight.SemiBold)) { append(segment.text) } else append(segment.text)
                            }
                        }
                    }
                    Text(text, style = MaterialTheme.typography.bodySmall.mono(), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (hidden > 0) Text(pluralStringResource(R.plurals.format_more_matches, hidden, hidden), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A log's lines with their links found, monospaced, in a capped box opening at its newest lines. */
@Composable
fun LogBox(lines: List<LogLine>, hidden: Int, title: String, source: String, links: ToolLinks, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    // Started past its end: the state settles on the last line once the box knows its height.
    val scroll = rememberScrollState(Int.MAX_VALUE)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        CodeSurface {
            LogLines(lines, MaterialTheme.typography.bodySmall.mono(), color, Modifier.heightIn(max = OUTPUT_MAX).verticalScroll(scroll).padding(8.dp))
        }
        if (hidden > 0) {
            TextButton(onClick = { links.openLog(title, source) }) {
                Text(pluralStringResource(R.plurals.format_more_lines, hidden, hidden), color = formatLink)
            }
        }
    }
}

/** Lines of text that is not markdown, as the core gave them (`formatLog`), with their links live. */
@Composable
fun LogLines(lines: List<LogLine>, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    val look = spanLook(style)
    Column(modifier) {
        lines.forEach { line ->
            val text = rememberSpans(line.spans, look)
            Text(if (line.spans.isEmpty()) AnnotatedString(" ") else text, style = style, color = color)
        }
    }
}

/** A command as the agent wrote it, coloured as shell, after a dimmed `$`. */
@Composable
fun CommandLine(command: String) {
    val colors = CodeColors.current
    val lines = highlightedLines(command, "bash", colors)
    val dim = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f)
    val text = remember(lines, dim) {
        buildAnnotatedString {
            withStyle(SpanStyle(color = dim)) { append("$ ") }
            lines.forEachIndexed { index, line ->
                if (index > 0) append("\n  ")
                append(line)
            }
        }
    }
    SelectionContainer { Text(text, style = MaterialTheme.typography.bodySmall.mono(), color = colors.plain) }
}
