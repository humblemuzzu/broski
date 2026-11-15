package com.muzammil.broski.feature.workspace.terminal

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiMotion
import com.muzammil.broski.design.mono

@Composable
fun TerminalMenu(onCopyAll: () -> Unit, onClose: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.files_more))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.terminal_copy_all)) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_content_copy), contentDescription = null) },
                onClick = {
                    open = false
                    onCopyAll()
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.terminal_close)) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_close), contentDescription = null) },
                onClick = {
                    open = false
                    onClose()
                },
            )
        }
    }
}

@Composable
fun CloseTerminalDialog(onClose: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.terminal_close_title)) },
        text = { Text(stringResource(R.string.terminal_close_body)) },
        confirmButton = {
            TextButton(onClick = onClose, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                Text(stringResource(R.string.terminal_close))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** A paste with a line break runs each line as it lands; the person sees exactly what would run first. */
@Composable
fun UnsafePasteDialog(text: String, onPaste: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.terminal_unsafe_paste_title)) },
        text = {
            Text(
                text,
                style = MaterialTheme.typography.bodySmall.mono(),
                modifier = Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()),
            )
        },
        confirmButton = { TextButton(onClick = onPaste) { Text(stringResource(R.string.terminal_paste)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Copy or let go of what was selected, floating over the top of the terminal. */
@Composable
fun SelectionBar(visible: Boolean, onCopy: () -> Unit, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(BroskiMotion.spring()) + scaleIn(BroskiMotion.spring()),
        exit = fadeOut(BroskiMotion.spring()) + scaleOut(BroskiMotion.spring()),
        modifier = modifier,
    ) {
        Surface(shape = MaterialTheme.shapes.extraLarge, tonalElevation = 6.dp, shadowElevation = 6.dp) {
            Row(Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onCopy) { Text(stringResource(R.string.terminal_copy)) }
                TextButton(onClick = onCancel) { Text(stringResource(R.string.action_cancel)) }
            }
        }
    }
}

@Composable
fun JumpToBottom(onClick: () -> Unit, modifier: Modifier = Modifier) {
    SmallFloatingActionButton(onClick = onClick, modifier = modifier) {
        Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = stringResource(R.string.terminal_jump_to_bottom))
    }
}

/** How the terminal ended, in words, over its last screen. */
@Composable
fun EndedBanner(state: TerminalState, modifier: Modifier = Modifier) {
    val text = when (state) {
        is TerminalState.Exited -> when {
            state.signal != null -> stringResource(R.string.terminal_exited_signal, state.signal)
            state.exitCode != null -> stringResource(R.string.terminal_exited_code, state.exitCode)
            else -> stringResource(R.string.terminal_exited)
        }
        is TerminalState.Failed -> stringResource(R.string.terminal_failed, state.message.orEmpty())
        TerminalState.Live -> return
    }
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.large,
        modifier = modifier.fillMaxWidth().padding(16.dp),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}
