package com.muzammil.broski.design.format.tools

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.code.highlightedLines
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.formatLink
import com.muzammil.broski.design.mono
import uniffi.broski_core.ArgumentValue
import uniffi.broski_core.ToolArgument

private val CODE_MAX = 180.dp
/** Lines of an argument's prose shown until it is opened. */
private const val FOLDED_LINES = 6
private val INDENT = 14.dp

/**
 * A call's arguments as the core lays them out (`toolArguments`): a property list where short values
 * sit beside their key, long ones and code under it, the agent's own prose formatted and folded, and
 * objects open one level further in.
 */
@Composable
fun ToolArguments(rows: List<ToolArgument>, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        rows.forEach { row -> ArgumentRow(row, Modifier.padding(start = INDENT * minOf(row.depth.toInt(), 4))) }
    }
}

@Composable
private fun ArgumentRow(row: ToolArgument, modifier: Modifier) {
    when (val value = row.value) {
        is ArgumentValue.Inline -> Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Key(row.key)
            SelectionContainer {
                Text(value.text, style = MaterialTheme.typography.bodySmall.mono(), color = CodeColors.current.of(value.kind))
            }
        }
        is ArgumentValue.Text -> Under(row.key, modifier) {
            FormattedMessage(value.text, role = FormatRole.Quiet)
            Hidden(value.hiddenLines.toInt())
        }
        is ArgumentValue.Code -> Under(row.key, modifier) {
            ArgumentCode(value.text, value.language)
            Hidden(value.hiddenLines.toInt())
        }
        is ArgumentValue.Markdown -> Under(row.key, modifier) { FoldedProse(value.text) }
        is ArgumentValue.Nested -> Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Key(row.key)
            val count = value.count.toInt()
            Text(
                pluralStringResource(if (value.list) R.plurals.format_items else R.plurals.format_fields, count, count),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        is ArgumentValue.More -> Text(
            pluralStringResource(R.plurals.format_more_arguments, value.count.toInt(), value.count.toInt()),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier,
        )
    }
}

@Composable
private fun Key(key: String) {
    Text(key, style = MaterialTheme.typography.labelMedium.mono().copy(fontWeight = FontWeight.Medium), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun Under(key: String, modifier: Modifier, value: @Composable () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Key(key)
        value()
    }
}

@Composable
private fun Hidden(lines: Int) {
    if (lines > 0) Text(pluralStringResource(R.plurals.format_more_lines, lines, lines), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A code value in its language's colours, in a box that scrolls past a few lines. */
@Composable
private fun ArgumentCode(text: String, language: String?) {
    val colors = CodeColors.current
    val lines = highlightedLines(text, language, colors)
    val joined = remember(lines) {
        androidx.compose.ui.text.buildAnnotatedString {
            lines.forEachIndexed { index, line ->
                if (index > 0) append('\n')
                append(line)
            }
        }
    }
    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.fillMaxWidth()) {
        SelectionContainer {
            Text(joined, style = MaterialTheme.typography.bodySmall.mono(), color = colors.plain, softWrap = false, modifier = Modifier.heightIn(max = CODE_MAX).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(8.dp))
        }
    }
}

/** The agent's prose (a subagent's prompt, a plan) formatted, folded to about six lines. */
@Composable
private fun FoldedProse(text: String) {
    var open by remember { mutableStateOf(false) }
    val long = text.length > LONG_PROSE || text.count { it == '\n' } > 5
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val folded = FormatRole.Quiet.linesHeight(FOLDED_LINES)
        Box(if (long && !open) Modifier.heightIn(max = folded).clipToBounds() else Modifier) {
            FormattedText(text, role = FormatRole.Quiet, menu = false)
        }
        if (long && !open) TextButton(onClick = { open = true }) { Text(stringResource(R.string.format_show_more), color = formatLink) }
    }
}

private const val LONG_PROSE = 360
