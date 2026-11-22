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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.format.tools.FileTextBody
import com.muzammil.broski.design.format.tools.ReportBody
import com.muzammil.broski.design.format.agentLine
import uniffi.broski_contract.LinkItem
import uniffi.broski_contract.TodoItem
import uniffi.broski_contract.TodoStatus
import uniffi.broski_contract.ToolDisplay

/** Files listed in place; the rest are counted. */
private const val SHOWN_FILES = 20

/**
 * What a call's result shows in place of its text when its tool has a view of its own: the agent's
 * task list as a checklist, the pages a search found as links, the files a search found, each
 * opening in Files, a report formatted, a read file's numbered lines.
 */
@Composable
internal fun ToolDisplayView(display: ToolDisplay, actions: WorkActions, title: String) {
    when (display) {
        is ToolDisplay.Todos -> TodoList(display.v1.items)
        is ToolDisplay.Links -> LinkList(display.v1.items)
        is ToolDisplay.Files -> FileList(display.v1.paths, display.v1.total, actions.openFile)
        is ToolDisplay.Markdown -> ReportBody(display.v1.text, title, actions.toolLinks)
        is ToolDisplay.FileText -> with(display.v1) { FileTextBody(path, null, firstLine.toInt(), text, note, actions.toolLinks) }
    }
}

@Composable
private fun TodoList(items: List<TodoItem>) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach { item ->
            val done = item.status == TodoStatus.COMPLETED
            val doing = item.status == TodoStatus.IN_PROGRESS
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (done) "☑" else "☐",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (doing) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                FormattedMessage(item.text, Modifier.alpha(if (done) 0.6f else 1f), role = FormatRole.Quiet)
            }
        }
    }
}

@Composable
private fun LinkList(items: List<LinkItem>) {
    val uris = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEach { item ->
            Row(
                Modifier.fillMaxWidth().clickable { uris.openUri(item.url) }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        agentLine(item.title).ifEmpty { item.url },
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        item.url.toUri().host ?: item.url,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null, modifier = Modifier.size(14.dp))
            }
        }
    }
}

@Composable
private fun FileList(paths: List<String>, total: Long?, open: (String) -> Unit) {
    val shown = paths.take(SHOWN_FILES)
    val more = maxOf(total?.toInt() ?: 0, paths.size) - shown.size
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        shown.forEach { path ->
            Row(
                Modifier.fillMaxWidth().clickable { open(path) }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(painterResource(R.drawable.ic_description), contentDescription = null, modifier = Modifier.size(14.dp))
                Text(path.substringAfterLast('/'), style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium))
                Text(
                    path.substringBeforeLast('/', ""),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.StartEllipsis,
                )
            }
        }
        if (more > 0) {
            Text(
                pluralStringResource(R.plurals.chat_more_files, more, more),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
