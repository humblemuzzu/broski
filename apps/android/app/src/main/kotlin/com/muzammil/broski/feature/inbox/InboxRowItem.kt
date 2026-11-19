package com.muzammil.broski.feature.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ListItemShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Dot
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.displayName
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.label
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.relativeTime
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

private const val OFFLINE_ALPHA = 0.55f

/**
 * One session: agent mark, title, what it asks, machine and folder, when, and its state at the
 * end. A row of a machine that is not online, or known only from the cached inbox, stays listed,
 * dimmed, with the machine's status. A tool permission the backend lets one tap answer offers
 * Approve and Deny on a long press (on a tap too while no chat opens) and to TalkBack.
 */
@Composable
fun InboxRowItem(
    row: InboxRow,
    health: MachineHealth?,
    shapes: ListItemShapes,
    onOpen: (() -> Unit)?,
    busy: Boolean,
    onAnswer: (Decision) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = row.title ?: stringResource(R.string.inbox_untitled)
    val ask = askLine(row)
    val offline = row.cached || (health != null && !health.isOnline)
    val healthLabel = health?.takeIf { !it.isOnline }?.label(row.machineName)
    val decisions = row.quickDecisions
    var menuOpen by remember { mutableStateOf(false) }
    val showMenu = { menuOpen = true }
    val description = stringResource(
        R.string.inbox_row_description,
        stringResource(row.state.label),
        if (row.state == InboxState.NEEDS_YOU) ask else title,
        listOfNotNull(listOfNotNull(row.machineName, row.folder).joinToString(", "), healthLabel).joinToString(". "),
    )
    val actions = decisions.map { decision ->
        CustomAccessibilityAction(stringResource(decision.label)) {
            onAnswer(decision)
            true
        }
    }
    val open = onOpen ?: showMenu.takeIf { decisions.isNotEmpty() }
    val semantics = modifier.alpha(if (offline) OFFLINE_ALPHA else 1f).clearAndSetSemantics {
        contentDescription = description
        customActions = actions
        open?.let { action ->
            onClick {
                action()
                true
            }
        }
    }
    Box {
        RowItem(row, title, ask, healthLabel, shapes, open, showMenu.takeIf { decisions.isNotEmpty() }, semantics)
        RowAnswerMenu(menuOpen, decisions, busy, onDismiss = { menuOpen = false }) { decision ->
            menuOpen = false
            onAnswer(decision)
        }
    }
}

/** "Claude Code wants to run npm test", or the agent's own words for any other ask. */
@Composable
private fun askLine(row: InboxRow): String = row.command
    ?.let { stringResource(R.string.inbox_wants_to_run, stringResource(row.session.backend.displayName), it) }
    ?: row.ask
    ?: stringResource(R.string.inbox_waiting_for_you)

@Composable
private fun RowItem(
    row: InboxRow,
    title: String,
    ask: String,
    healthLabel: String?,
    shapes: ListItemShapes,
    onClick: (() -> Unit)?,
    onLongClick: (() -> Unit)?,
    modifier: Modifier,
) {
    val supporting: @Composable () -> Unit = { RowSupporting(row, ask, healthLabel) }
    val leading: @Composable () -> Unit = { AgentMark(row.session.backend) }
    val trailing: @Composable () -> Unit = { StateMark(row.state) }
    val headline: @Composable () -> Unit = { Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    if (onClick != null) {
        SegmentedListItem(
            onClick = onClick,
            shapes = shapes,
            modifier = modifier,
            leadingContent = leading,
            trailingContent = trailing,
            supportingContent = supporting,
            onLongClick = onLongClick,
            colors = groupedListItemColors(),
            content = headline,
        )
    } else {
        SegmentedListItem(
            shapes = shapes,
            modifier = modifier,
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
        InboxState.WORKING -> Orb(OrbState.WORKING, size = 18.dp)
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
