package com.muzammil.broski.feature.chat.header

import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.selectAll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.muzammil.broski.R

/** What the session's overflow offers: an item without its action is one the session cannot do. */
class SessionMenuActions(
    val openFiles: (() -> Unit)?,
    val openChanges: (() -> Unit)?,
    val openTerminal: (() -> Unit)?,
    val pinned: Boolean,
    val togglePin: () -> Unit,
    val rename: (() -> Unit)?,
    val markUnread: (() -> Unit)?,
    val muted: Boolean,
    val toggleMute: () -> Unit,
    val compact: (() -> Unit)?,
    val fork: (() -> Unit)?,
    val shareMarkdown: () -> Unit,
    val copyConversation: () -> Unit,
    val sessionInfo: () -> Unit,
    val delete: (() -> Unit)?,
)

/**
 * The overflow: the session's folder (its files, what changed, a terminal in it), the session itself,
 * then its conversation, then Delete apart from the rest.
 */
@Composable
fun SessionMenu(expanded: Boolean, actions: SessionMenuActions, onDismiss: () -> Unit) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if (actions.openFiles != null) {
            MenuItem(R.string.chat_menu_files, R.drawable.ic_folder_open, actions.openFiles, onDismiss)
            MenuItem(R.string.chat_menu_changes, R.drawable.ic_difference, actions.openChanges, onDismiss)
            MenuItem(R.string.chat_menu_terminal, R.drawable.ic_terminal, actions.openTerminal, onDismiss)
            HorizontalDivider()
        }
        if (actions.pinned) {
            MenuItem(R.string.session_unpin, R.drawable.ic_keep_off, actions.togglePin, onDismiss)
        } else {
            MenuItem(R.string.session_pin, R.drawable.ic_keep, actions.togglePin, onDismiss)
        }
        MenuItem(R.string.chat_rename, R.drawable.ic_edit, actions.rename, onDismiss)
        if (actions.muted) {
            MenuItem(R.string.session_unmute, R.drawable.ic_notifications, actions.toggleMute, onDismiss)
        } else {
            MenuItem(R.string.session_mute, R.drawable.ic_notifications_off, actions.toggleMute, onDismiss)
        }
        MenuItem(R.string.session_mark_unread, R.drawable.ic_mark_chat_unread, actions.markUnread, onDismiss)
        HorizontalDivider()
        MenuItem(R.string.chat_compact, R.drawable.ic_compress, actions.compact, onDismiss)
        MenuItem(R.string.chat_fork, R.drawable.ic_call_split, actions.fork, onDismiss)
        MenuItem(R.string.chat_share_markdown, R.drawable.ic_share, actions.shareMarkdown, onDismiss)
        MenuItem(R.string.chat_copy_conversation, R.drawable.ic_content_copy, actions.copyConversation, onDismiss)
        MenuItem(R.string.chat_session_info, R.drawable.ic_info, actions.sessionInfo, onDismiss)
        if (actions.delete != null) {
            HorizontalDivider()
            MenuItem(R.string.chat_delete, R.drawable.ic_delete, actions.delete, onDismiss, destructive = true)
        }
    }
}

@Composable
private fun MenuItem(label: Int, icon: Int, action: (() -> Unit)?, onDismiss: () -> Unit, destructive: Boolean = false) {
    action ?: return
    val color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    DropdownMenuItem(
        text = { Text(stringResource(label), color = color) },
        leadingIcon = { Icon(painterResource(icon), contentDescription = null, tint = color) },
        onClick = {
            onDismiss()
            action()
        },
    )
}

/** The title to give the session, its current one selected to type over. */
@Composable
fun RenameDialog(current: String, onRename: (String) -> Unit, onDismiss: () -> Unit) {
    val field = rememberTextFieldState(current)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        field.edit { selectAll() }
        focus.requestFocus()
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chat_rename_title)) },
        text = {
            OutlinedTextField(field, lineLimits = TextFieldLineLimits.SingleLine, modifier = Modifier.focusRequester(focus))
        },
        confirmButton = {
            TextButton(
                onClick = { onRename(field.text.toString()) },
                enabled = field.text.isNotBlank() && field.text.toString() != current,
            ) { Text(stringResource(R.string.chat_rename_confirm)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
fun DeleteDialog(title: String, onDelete: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chat_delete_title, title)) },
        text = { Text(stringResource(R.string.chat_delete_body)) },
        confirmButton = {
            TextButton(onClick = onDelete) { Text(stringResource(R.string.chat_delete_confirm), color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
