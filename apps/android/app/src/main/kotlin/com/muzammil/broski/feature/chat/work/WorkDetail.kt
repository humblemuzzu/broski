package com.muzammil.broski.feature.chat.work

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.tools.CommandLine
import com.muzammil.broski.design.format.tools.LogLines
import com.muzammil.broski.design.format.tools.ToolArguments
import com.muzammil.broski.design.format.tools.ToolBodyView
import com.muzammil.broski.design.mono
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.ToolDisplay
import uniffi.broski_core.ClipEnd
import uniffi.broski_core.ToolFacts
import uniffi.broski_core.formatLog
import uniffi.broski_core.toolArguments
import uniffi.broski_core.toolBody

/** A row opened in place: the call as sent, the last lines it printed (or that it printed nothing), its files and its subagent. */
@Composable
internal fun EntryDetail(entry: WorkEntry, actions: WorkActions) {
    Column(
        Modifier.fillMaxWidth().padding(start = 38.dp, end = 12.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        when (entry) {
            is WorkEntry.Tool -> ToolDetail(entry, actions)
            is WorkEntry.Thought -> FormattedText(entry.text, role = FormatRole.Quiet, streaming = entry.live)
            is WorkEntry.Aside -> FormattedText(entry.text, role = FormatRole.Quiet)
        }
    }
}

/**
 * A call opened in place: the command coloured as shell, its arguments as a property list, what its
 * result shows (its tool's own view, else how the core reads the output), its error, its files and
 * its subagent.
 */
@Composable
private fun ToolDetail(tool: WorkEntry.Tool, actions: WorkActions) {
    val facts = remember(tool) { ToolFacts(tool.name, null, tool.input, tool.childSession != null, tool.fileChanges.map { it.path }) }
    tool.look.command?.let { CommandLine(it) }
    if (tool.display !is ToolDisplay.Todos) {
        val arguments = remember(facts) { toolArguments(facts) }
        if (arguments.isNotEmpty()) ToolArguments(arguments)
    }
    val display = tool.display
    when {
        display != null -> ToolDisplayView(display, actions, tool.label)
        tool.output.isNotEmpty() -> {
            val body = remember(facts, tool.output) { toolBody(facts, tool.output) }
            ToolBodyView(body, tool.label, tool.output, actions.toolLinks)
        }
        !tool.running && tool.fileChanges.isEmpty() && tool.error == null ->
            Text(stringResource(R.string.chat_work_no_output), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    tool.error?.let { error ->
        val lines = remember(error) { formatLog(error, ERROR_LINES, ClipEnd.HEAD).lines }
        LogLines(lines, MaterialTheme.typography.bodySmall.mono(), MaterialTheme.colorScheme.error)
    }
    tool.fileChanges.forEach { change -> FileChangeRow(change) { actions.openDiff(change) } }
    tool.childSession?.let { child ->
        TextButton(onClick = { actions.openSession(child) }) {
            Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null, modifier = Modifier.size(16.dp))
            Text(stringResource(R.string.chat_work_open_subagent), modifier = Modifier.padding(start = 6.dp))
        }
    }
}

/** Lines of an error drawn in place. */
private const val ERROR_LINES = 40u

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
