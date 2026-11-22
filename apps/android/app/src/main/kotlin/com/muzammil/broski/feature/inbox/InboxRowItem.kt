package com.muzammil.broski.feature.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineName
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Dot
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.label
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.relativeTime
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

private const val OFFLINE_ALPHA = 0.55f

/**
 * One session: agent mark, title, what it asks, its folder (and its Mac once more than one is
 * paired), when, and its state at the end, a pin and a muted bell beside it when the person set them. A row of a machine that is not
 * online, or known only from the cached inbox, stays listed, dimmed, with the machine's status. A long
 * press (a tap too while no chat opens) and TalkBack offer Approve and Deny for a tool permission the
 * backend lets one tap answer, then pin, read state and mute.
 */
@Composable
fun InboxRowItem(
    row: InboxRow,
    agent: Agent,
    health: MachineHealth?,
    showsMachine: Boolean,
    shapes: ListItemShapes,
    onOpen: (() -> Unit)?,
    busy: Boolean,
    pinned: Boolean,
    muted: Boolean,
    onAnswer: (Decision) -> Unit,
    onAction: (RowAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = row.title ?: stringResource(R.string.inbox_untitled)
    val ask = askLine(row, agent)
    val offline = row.cached || (health != null && !health.isOnline)
    val machine = MachineName.display(row.machineName)
    val look = RowLook(title, ask, health?.takeIf { !it.isOnline }?.label(machine), machine.takeIf { showsMachine }, pinned, muted)
    val decisions = row.quickDecisions
    val sessionActions = row.actions(pinned, muted)
    var menuOpen by remember { mutableStateOf(false) }
    val showMenu = { menuOpen = true }
    val open = onOpen ?: showMenu
    val semantics = modifier.rowSemantics(
        description = rowDescription(row, look),
        actions = accessibilityActions(decisions, sessionActions, onAnswer, onAction),
        offline = offline,
        open = open,
    )
    Box {
        RowItem(row, agent, look, shapes, open, showMenu, semantics)
        RowMenu(
            expanded = menuOpen,
            decisions = decisions,
            actions = sessionActions,
            busy = busy,
            onDismiss = { menuOpen = false },
            onAnswer = onAnswer,
            onAction = onAction,
        )
    }
}

/** What TalkBack reads: the state, then what it asks or its title, then where it runs and how its machine is. */
@Composable
private fun rowDescription(row: InboxRow, look: RowLook): String = stringResource(
    R.string.inbox_row_description,
    stringResource(row.state.label),
    if (row.state == InboxState.NEEDS_YOU) look.ask else look.title,
    listOfNotNull(listOfNotNull(look.machine, row.folder).joinToString(", ").ifEmpty { null }, look.healthLabel).joinToString(". "),
)

@Composable
private fun accessibilityActions(
    decisions: List<Decision>,
    sessionActions: List<RowAction>,
    onAnswer: (Decision) -> Unit,
    onAction: (RowAction) -> Unit,
): List<CustomAccessibilityAction> = decisions.map { decision ->
    CustomAccessibilityAction(stringResource(decision.label)) {
        onAnswer(decision)
        true
    }
} + sessionActions.map { action ->
    CustomAccessibilityAction(stringResource(action.label)) {
        onAction(action)
        true
    }
}

/** Dimmed while offline; one node for TalkBack that opens on a tap and offers every action. */
private fun Modifier.rowSemantics(description: String, actions: List<CustomAccessibilityAction>, offline: Boolean, open: () -> Unit) =
    alpha(if (offline) OFFLINE_ALPHA else 1f).clearAndSetSemantics {
        contentDescription = description
        customActions = actions
        onClick {
            open()
            true
        }
    }

/** "Claude Code wants to run npm test", or the agent's own words for any other ask. */
@Composable
private fun askLine(row: InboxRow, agent: Agent): String = row.command
    ?.let { stringResource(R.string.inbox_wants_to_run, agent.name, it) }
    ?: row.ask
    ?: stringResource(R.string.inbox_waiting_for_you)

/** The words a row shows and the marks the person set on its session. */
private class RowLook(
    val title: String,
    val ask: String,
    val healthLabel: String?,
    /** The Mac's name, only while more than one is paired. */
    val machine: String?,
    val pinned: Boolean,
    val muted: Boolean,
)

@Composable
private fun RowItem(
    row: InboxRow,
    agent: Agent,
    look: RowLook,
    shapes: ListItemShapes,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier,
) {
    val headline = look.title
    SegmentedListItem(
        onClick = onClick,
        shapes = shapes,
        modifier = modifier,
        leadingContent = { AgentMark(agent) },
        trailingContent = { Trailing(row.state, look) },
        supportingContent = { RowSupporting(row, look) },
        onLongClick = onLongClick,
        colors = groupedListItemColors(),
        content = { Text(headline, maxLines = 2, overflow = TextOverflow.Ellipsis) },
    )
}

@Composable
private fun Trailing(state: InboxState, look: RowLook) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        val tint = MaterialTheme.colorScheme.onSurfaceVariant
        if (look.muted) Icon(painterResource(R.drawable.ic_notifications_off), contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        if (look.pinned) Icon(painterResource(R.drawable.ic_keep), contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        StateMark(state)
    }
}

private val InboxRow.folder: String? get() = cwd?.trimEnd('/')?.substringAfterLast('/')

@Composable
private fun RowSupporting(row: InboxRow, look: RowLook) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (row.state == InboxState.NEEDS_YOU) {
            Text(look.ask, color = BroskiTheme.semantic.needsYou, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(
            listOfNotNull(look.machine, row.folder, relativeTime(row.updatedAt)).joinToString(" · "),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        look.healthLabel?.let { Text(it, style = MaterialTheme.typography.labelMedium) }
    }
}

@Composable
private fun StateMark(state: InboxState) {
    when (state) {
        InboxState.NEEDS_YOU -> Dot(BroskiTheme.semantic.needsYou)
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

val InboxGroup.label: Int
    get() = when (this) {
        InboxGroup.NEEDS_YOU -> R.string.inbox_section_needs_you
        InboxGroup.PINNED -> R.string.inbox_section_pinned
        InboxGroup.WORKING -> R.string.inbox_section_working
        InboxGroup.DONE -> R.string.inbox_section_done
        InboxGroup.IDLE -> R.string.inbox_section_idle
    }
