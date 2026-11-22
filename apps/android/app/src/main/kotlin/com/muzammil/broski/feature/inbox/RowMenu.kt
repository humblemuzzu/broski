package com.muzammil.broski.feature.inbox

import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.muzammil.broski.R
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

/** What a row's menu does to its session, besides answering it. */
enum class RowAction { Pin, Unpin, MarkUnread, MarkRead, Mute, Unmute }

/** Pin or Unpin; Mark as Unread once settled and seen, Mark as Read while Done; Mute or Unmute. */
fun InboxRow.actions(pinned: Boolean, muted: Boolean): List<RowAction> = listOfNotNull(
    if (pinned) RowAction.Unpin else RowAction.Pin,
    when (state) {
        InboxState.IDLE -> RowAction.MarkUnread
        InboxState.DONE -> RowAction.MarkRead
        InboxState.NEEDS_YOU, InboxState.WORKING -> null
    },
    if (muted) RowAction.Unmute else RowAction.Mute,
)

/** Approve and Deny for a row's pending tool permission, then what else can be done to its session; a tap closes the menu, then acts. */
@Composable
fun RowMenu(
    expanded: Boolean,
    decisions: List<Decision>,
    actions: List<RowAction>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onAnswer: (Decision) -> Unit,
    onAction: (RowAction) -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        decisions.forEach { decision ->
            val tint = when (decision) {
                Decision.Approve -> MaterialTheme.colorScheme.primary
                Decision.Deny -> MaterialTheme.colorScheme.error
            }
            DropdownMenuItem(
                text = { Text(stringResource(decision.label)) },
                onClick = {
                    onDismiss()
                    onAnswer(decision)
                },
                enabled = !busy,
                leadingIcon = { Icon(painterResource(decision.icon), contentDescription = null, tint = tint) },
            )
        }
        if (decisions.isNotEmpty() && actions.isNotEmpty()) HorizontalDivider()
        actions.forEach { action ->
            DropdownMenuItem(
                text = { Text(stringResource(action.label)) },
                onClick = {
                    onDismiss()
                    onAction(action)
                },
                leadingIcon = { Icon(painterResource(action.icon), contentDescription = null) },
            )
        }
    }
}

val Decision.label: Int
    get() = when (this) {
        Decision.Approve -> R.string.inbox_approve
        Decision.Deny -> R.string.inbox_deny
    }

private val Decision.icon: Int
    get() = when (this) {
        Decision.Approve -> R.drawable.ic_check_circle
        Decision.Deny -> R.drawable.ic_block
    }

val RowAction.label: Int
    get() = when (this) {
        RowAction.Pin -> R.string.session_pin
        RowAction.Unpin -> R.string.session_unpin
        RowAction.MarkUnread -> R.string.session_mark_unread
        RowAction.MarkRead -> R.string.session_mark_read
        RowAction.Mute -> R.string.session_mute
        RowAction.Unmute -> R.string.session_unmute
    }

val RowAction.icon: Int
    get() = when (this) {
        RowAction.Pin -> R.drawable.ic_keep
        RowAction.Unpin -> R.drawable.ic_keep_off
        RowAction.MarkUnread -> R.drawable.ic_mark_chat_unread
        RowAction.MarkRead -> R.drawable.ic_mark_chat_read
        RowAction.Mute -> R.drawable.ic_notifications_off
        RowAction.Unmute -> R.drawable.ic_notifications
    }
