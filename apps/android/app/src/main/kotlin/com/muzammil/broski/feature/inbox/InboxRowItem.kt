package com.muzammil.broski.feature.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularWavyProgressIndicator
import androidx.compose.material3.ListItemShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Dot
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.label
import com.muzammil.broski.design.relativeTime
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

private const val OFFLINE_ALPHA = 0.55f

/**
 * One session: agent mark, title, machine and folder, when, and its state at the end. A row of a
 * machine that is not online stays listed, dimmed, with the machine's status.
 */
@Composable
fun InboxRowItem(
    row: InboxRow,
    health: MachineHealth?,
    shapes: ListItemShapes,
    onOpen: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val title = row.title ?: stringResource(R.string.inbox_untitled)
    val ask = row.ask ?: stringResource(R.string.inbox_waiting_for_you)
    val offline = health != null && !health.isOnline
    val healthLabel = health?.takeIf { offline }?.label(row.machineName)
    val description = stringResource(
        R.string.inbox_row_description,
        stringResource(row.state.label),
        if (row.state == InboxState.NEEDS_YOU) ask else title,
        listOfNotNull(listOfNotNull(row.machineName, row.folder).joinToString(", "), healthLabel).joinToString(". "),
    )
    val dimmed = modifier
        .alpha(if (offline) OFFLINE_ALPHA else 1f)
        .clearAndSetSemantics {
            contentDescription = description
            if (onOpen != null) {
                onClick {
                    onOpen()
                    true
                }
            }
        }
    val supporting: @Composable () -> Unit = { RowSupporting(row, ask, healthLabel) }
    val leading: @Composable () -> Unit = { AgentMark(row.session.backend) }
    val trailing: @Composable () -> Unit = { StateMark(row.state) }
    val headline: @Composable () -> Unit = { Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    if (onOpen != null) {
        SegmentedListItem(
            onClick = onOpen,
            shapes = shapes,
            modifier = dimmed,
            leadingContent = leading,
            trailingContent = trailing,
            supportingContent = supporting,
            colors = groupedListItemColors(),
            content = headline,
        )
    } else {
        SegmentedListItem(
            shapes = shapes,
            modifier = dimmed,
            leadingContent = leading,
            trailingContent = trailing,
            supportingContent = supporting,
            colors = groupedListItemColors(),
            content = headline,
        )
    }
}

private val InboxRow.folder: String? get() = cwd?.trimEnd('/')?.substringAfterLast('/')

@Composable
private fun RowSupporting(row: InboxRow, ask: String, healthLabel: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (row.state == InboxState.NEEDS_YOU) {
            Text(ask, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(
            listOfNotNull(row.machineName, row.folder, relativeTime(row.updatedAt)).joinToString(" · "),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        healthLabel?.let { Text(it, style = MaterialTheme.typography.labelMedium) }
    }
}

@Composable
private fun StateMark(state: InboxState) {
    when (state) {
        InboxState.NEEDS_YOU -> Dot(MaterialTheme.colorScheme.primary)
        InboxState.WORKING -> CircularWavyProgressIndicator(
            modifier = Modifier.size(24.dp),
            color = BroskiTheme.semantic.working,
        )
        InboxState.DONE -> Dot(BroskiTheme.semantic.done)
        InboxState.IDLE -> Unit
    }
}

val InboxState.label: Int
    get() = when (this) {
        InboxState.NEEDS_YOU -> R.string.inbox_section_needs_you
        InboxState.WORKING -> R.string.inbox_section_working
        InboxState.DONE -> R.string.inbox_section_done
        InboxState.IDLE -> R.string.inbox_section_idle
    }
