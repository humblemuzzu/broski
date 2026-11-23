package com.muzammil.broski.feature.inbox

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.muzammil.broski.design.SwipeAction
import com.muzammil.broski.design.SwipeActions
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineName
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Dot
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.label
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.shortAge
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

private const val OFFLINE_ALPHA = 0.5f

/**
 * One session, every one alike: the agent's mark, the title on one line, whether it is pinned or
 * muted, how long ago, and its state in a column of its own (a dot for needs you and done, the orb
 * while working), so the ages line up down the list. One that needs the person says what it asks on a
 * short second line; one whose Mac cannot be reached, or known only from the cached inbox, stays
 * listed, dimmed, with the machine's status there. A long press (a tap too while no chat opens) and
 * TalkBack offer Approve and Deny for a permission one tap answers, then pin, read state and mute.
 */
@Composable
fun InboxRowItem(
    row: InboxRow,
    agent: Agent,
    health: MachineHealth?,
    showsMachine: Boolean,
    index: Int,
    count: Int,
    onOpen: (() -> Unit)?,
    busy: Boolean,
    pinned: Boolean,
    muted: Boolean,
    onAnswer: (Decision) -> Unit,
    onAction: (RowAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = row.title ?: stringResource(R.string.inbox_untitled)
    val offline = row.cached || (health != null && !health.isOnline)
    val machine = MachineName.display(row.machineName)
    val look = RowLook(title, askLine(row, agent), health?.takeIf { offline }?.label(machine), machine.takeIf { showsMachine }, pinned, muted)
    val decisions = row.quickDecisions
    val sessionActions = row.actions(pinned, muted)
    var menuOpen by remember { mutableStateOf(false) }
    val showMenu = { menuOpen = true }
    val open = onOpen ?: showMenu
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Grouped.margin)
            .clip(Grouped.shape(index, count))
            .background(Grouped.card),
    ) {
        SwipeActions(
            leading = leadingSwipes(sessionActions, onAction),
            trailing = trailingSwipes(decisions, busy, onAnswer),
        ) {
            RowLine(
                row, agent, look, open, showMenu,
                Modifier.background(Grouped.card).rowSemantics(rowDescription(row, look), accessibilityActions(decisions, sessionActions, onAnswer, onAction), offline, open),
            )
        }
        if (index > 0) {
            HorizontalDivider(
                modifier = Modifier.align(Alignment.TopStart).padding(start = SEPARATOR_INSET),
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
            )
        }
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

/** A swipe right: Mark as Read or Unread, then Pin or Unpin, as iOS offers them. */
@Composable
private fun leadingSwipes(actions: List<RowAction>, onAction: (RowAction) -> Unit): List<SwipeAction> {
    val blue = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Color(0xFF0A84FF) else Color(0xFF007AFF)
    val read = actions.firstOrNull { it == RowAction.MarkRead || it == RowAction.MarkUnread }
    val pin = actions.firstOrNull { it == RowAction.Pin || it == RowAction.Unpin }
    return listOfNotNull(
        read?.let { SwipeAction(stringResource(it.label), it.icon, blue) { onAction(it) } },
        pin?.let { SwipeAction(stringResource(it.label), it.icon, BroskiTheme.semantic.caution) { onAction(it) } },
    )
}

/** A swipe left: Approve and Deny, only for a permission one tap answers. */
@Composable
private fun trailingSwipes(decisions: List<Decision>, busy: Boolean, onAnswer: (Decision) -> Unit): List<SwipeAction> {
    val green = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Color(0xFF30D158) else Color(0xFF34C759)
    return decisions.map { decision ->
        when (decision) {
            Decision.Approve -> SwipeAction(stringResource(decision.label), R.drawable.ic_check, green, !busy) { onAnswer(decision) }
            Decision.Deny -> SwipeAction(stringResource(decision.label), R.drawable.ic_close, MaterialTheme.colorScheme.error, !busy) { onAnswer(decision) }
        }
    }
}

/** Where the hairline between rows starts: under the title, past the mark. */
private val SEPARATOR_INSET = 16.dp + 22.dp + 12.dp

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RowLine(row: InboxRow, agent: Agent, look: RowLook, onClick: () -> Unit, onLongClick: () -> Unit, modifier: Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .heightIn(min = 52.dp)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AgentMark(agent, size = 22.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(look.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            look.detail(row.state)?.let { (words, color) ->
                Text(words, color = color, fontSize = 13.sp, lineHeight = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Marks(look)
        Text(
            shortAge(row.updatedAt),
            style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) { StateMark(row.state) }
    }
}

@Composable
private fun Marks(look: RowLook) {
    if (!look.pinned && !look.muted) return
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        val tint = MaterialTheme.colorScheme.onSurfaceVariant
        if (look.pinned) Icon(painterResource(R.drawable.ic_keep), contentDescription = null, tint = tint, modifier = Modifier.size(12.dp))
        if (look.muted) Icon(painterResource(R.drawable.ic_notifications_off), contentDescription = null, tint = tint, modifier = Modifier.size(12.dp))
    }
}

/** What TalkBack reads: the state, then what it asks or its title, then where it runs and how its machine is. */
@Composable
private fun rowDescription(row: InboxRow, look: RowLook): String = stringResource(
    R.string.inbox_row_description,
    stringResource(row.state.label),
    look.ask ?: look.title,
    listOfNotNull(
        listOfNotNull(look.machine, row.folderName).joinToString(", ").ifEmpty { null },
        look.healthLabel,
        if (look.pinned) stringResource(R.string.inbox_pinned) else null,
        if (look.muted) stringResource(R.string.inbox_muted) else null,
    ).joinToString(". "),
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

/** "Claude Code wants to run npm test", or the agent's own words for any other ask; nothing without one. */
@Composable
private fun askLine(row: InboxRow, agent: Agent): String? = row.command
    ?.let { stringResource(R.string.inbox_wants_to_run, agent.name, it) }
    ?: row.ask

/** The words a row shows and the marks the person set on its session. */
private class RowLook(
    val title: String,
    val ask: String?,
    val healthLabel: String?,
    /** The Mac's name, only while more than one is paired. */
    val machine: String?,
    val pinned: Boolean,
    val muted: Boolean,
) {
    /** The second line: what the agent asks, else why its Mac cannot be reached. */
    @Composable
    fun detail(state: InboxState): Pair<String, Color>? = when {
        state == InboxState.NEEDS_YOU && ask != null -> ask to BroskiTheme.semantic.needsYou
        healthLabel != null -> healthLabel to MaterialTheme.colorScheme.onSurfaceVariant
        else -> null
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
