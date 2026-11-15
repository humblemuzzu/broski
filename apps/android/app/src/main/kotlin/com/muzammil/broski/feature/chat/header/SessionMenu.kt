package com.muzammil.broski.feature.chat.header

import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.input.selectAll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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

/** What the session's overflow offers: each item present only when the session can do it. */
class SessionMenuActions(
    val fork: (() -> Unit)?,
    val rename: (() -> Unit)?,
    val delete: (() -> Unit)?,
    val compact: (() -> Unit)?,
    val copyConversation: () -> Unit,
)

@Composable
fun SessionMenu(expanded: Boolean, actions: SessionMenuActions, onDismiss: () -> Unit) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        MenuItem(R.string.chat_fork, R.drawable.ic_call_split, actions.fork, onDismiss)
        MenuItem(R.string.chat_rename, R.drawable.ic_edit, actions.rename, onDismiss)
        MenuItem(R.string.chat_compact, R.drawable.ic_compress, actions.compact, onDismiss)
        MenuItem(R.string.chat_copy_conversation, R.drawable.ic_content_copy, actions.copyConversation, onDismiss)
        MenuItem(R.string.chat_delete, R.drawable.ic_delete, actions.delete, onDismiss, destructive = true)
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
