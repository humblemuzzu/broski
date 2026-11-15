package com.muzammil.broski.feature.chat.work

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.mono
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.JsonValue
import kotlin.math.abs

private val OUTPUT_MAX = 180.dp

/** A row opened in place: the call as sent, what it printed (or that it printed nothing), its files and its subagent. */
@Composable
internal fun EntryDetail(entry: WorkEntry, actions: WorkActions) {
    Column(
        Modifier.fillMaxWidth().padding(start = 38.dp, end = 12.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        when (entry) {
            is WorkEntry.Tool -> ToolDetail(entry, actions)
            is WorkEntry.Thought -> Prose(entry.text)
            is WorkEntry.Aside -> Prose(entry.text)
        }
    }
}

@Composable
private fun ToolDetail(tool: WorkEntry.Tool, actions: WorkActions) {
    tool.input?.let { input -> Mono(inputText(tool, input), MaterialTheme.colorScheme.onSurface) }
    val printed = listOfNotNull(tool.output.takeIf { it.isNotEmpty() }, tool.error).joinToString("\n")
    if (printed.isEmpty()) {
        if (!tool.running && tool.fileChanges.isEmpty()) Prose(stringResource(R.string.chat_work_no_output))
    } else {
        Mono(printed, if (tool.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
    }
    tool.fileChanges.forEach { change -> FileChangeRow(change) { actions.openDiff(change) } }
    tool.childSession?.let { child ->
        TextButton(onClick = { actions.openSession(child) }) {
            Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null, modifier = Modifier.size(16.dp))
            Text(stringResource(R.string.chat_work_open_subagent), modifier = Modifier.padding(start = 6.dp))
        }
    }
}

/** A command as typed; any other input as its members, one `key: value` a line. */
private fun inputText(tool: WorkEntry.Tool, input: JsonValue): String {
    tool.look.command?.let { return it }
    val members = (input as? JsonValue.Object)?.v1 ?: return render(input)
    return members.joinToString("\n") { "${it.key}: ${render(it.value)}" }
}

private fun render(value: JsonValue): String = when (value) {
    JsonValue.Null -> "null"
    is JsonValue.Bool -> value.v1.toString()
    is JsonValue.Number -> value.v1.let { if (it % 1.0 == 0.0 && abs(it) < 1e15) it.toLong().toString() else it.toString() }
    is JsonValue.String -> value.v1
    is JsonValue.Array -> value.v1.joinToString(", ", "[", "]") { render(it) }
    is JsonValue.Object -> value.v1.joinToString(", ", "{", "}") { "${it.key}: ${render(it.value)}" }
}

@Composable
private fun Mono(text: String, color: Color) {
    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest) {
        SelectionContainer {
            Text(
                text,
                style = MaterialTheme.typography.bodySmall.mono(),
                color = color,
                softWrap = false,
                modifier = Modifier
                    .heightIn(max = OUTPUT_MAX)
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
                    .padding(8.dp),
            )
        }
    }
}

@Composable
private fun Prose(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A file the call changed, with its counts; it opens the diff. */
@Composable
fun FileChangeRow(change: FileChange, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    Row(
        modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(painterResource(R.drawable.ic_difference), contentDescription = null, modifier = Modifier.size(16.dp))
        Text(change.path, style = MaterialTheme.typography.bodySmall.mono(), maxLines = 1, overflow = TextOverflow.StartEllipsis, modifier = Modifier.weight(1f))
        change.deletions?.let { Text("−$it", style = MaterialTheme.typography.labelMedium.mono(), color = MaterialTheme.colorScheme.error) }
        change.additions?.let { Text("+$it", style = MaterialTheme.typography.labelMedium.mono(), color = BroskiTheme.semantic.done) }
    }
}
