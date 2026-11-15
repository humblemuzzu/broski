package com.muzammil.broski.feature.workspace.terminal

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.TerminalRoute
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.relativeTime
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.WorkspaceUiState
import com.muzammil.broski.feature.workspace.WorkspaceViewModel
import com.muzammil.broski.feature.workspace.files.MonoPath
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.shortPath
import uniffi.broski_contract.TerminalStatus
import uniffi.broski_contract.TerminalSummary

/** A machine's terminals, newest first, and New terminal in one of the person's folders. */
@Composable
fun TerminalsSection(
    context: FeatureContext,
    machineId: String,
    available: Boolean,
    state: WorkspaceUiState,
    folders: List<String>,
    home: String?,
    viewModel: WorkspaceViewModel,
    open: (cwd: String) -> Unit,
) {
    if (!available) {
        EmptyState(stringResource(R.string.workspace_no_terminal_title), stringResource(R.string.workspace_no_terminal_body))
        return
    }
    var picking by rememberSaveable { mutableStateOf(false) }
    var closing by rememberSaveable { mutableStateOf<String?>(null) }
    Column {
        PrimaryButton(
            text = stringResource(R.string.terminal_new),
            onClick = { picking = true },
            icon = R.drawable.ic_add,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
        state.terminalsFailure?.let { FailureMessage(it, viewModel::refreshTerminals) }
        val terminals = state.terminals.orEmpty()
        if (terminals.isNotEmpty()) SectionHeader(stringResource(R.string.workspace_terminals))
        terminals.forEachIndexed { index, terminal ->
            TerminalRow(terminal, index, terminals.size, home, onOpen = {
                context.navigate(TerminalRoute(machineId, terminal.id, terminal.cwd))
            }, onClose = { closing = terminal.id })
        }
    }
    if (picking) {
        FolderSheet(folders, home, onPick = { cwd ->
            picking = false
            open(cwd)
        }, onDismiss = { picking = false })
    }
    closing?.let { id ->
        AlertDialog(
            onDismissRequest = { closing = null },
            title = { Text(stringResource(R.string.terminal_close_title)) },
            text = { Text(stringResource(R.string.terminal_close_body)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        closing = null
                        viewModel.closeTerminal(id)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.terminal_close)) }
            },
            dismissButton = { TextButton(onClick = { closing = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
private fun TerminalRow(terminal: TerminalSummary, index: Int, count: Int, home: String?, onOpen: () -> Unit, onClose: () -> Unit) {
    val running = terminal.status == TerminalStatus.RUNNING
    val status = when {
        running -> stringResource(R.string.terminal_running)
        terminal.signal != null -> stringResource(R.string.terminal_exited_signal, terminal.signal!!)
        terminal.exitCode != null -> stringResource(R.string.terminal_exited_code, terminal.exitCode!!)
        else -> stringResource(R.string.terminal_exited)
    }
    GroupedRow(
        index = index,
        count = count,
        onClick = onOpen,
        leading = {
            Icon(
                painterResource(if (running) R.drawable.ic_terminal else R.drawable.ic_check),
                contentDescription = null,
                tint = if (running) BroskiTheme.semantic.working else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        supporting = { Text("$status · ${shortPath(terminal.cwd, home)} · ${relativeTime(terminal.createdAt)}", maxLines = 2, overflow = TextOverflow.Ellipsis) },
        trailing = {
            IconButton(onClick = onClose) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.terminal_close))
            }
        },
    ) {
        Text(lastComponent(terminal.cwd), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FolderSheet(folders: List<String>, home: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        SectionHeader(stringResource(R.string.terminal_new_in))
        LazyColumn(Modifier.padding(bottom = 24.dp)) {
            itemsIndexed(folders, key = { _, folder -> folder }) { index, folder ->
                GroupedRow(
                    index = index,
                    count = folders.size,
                    onClick = { onPick(folder) },
                    leading = { Icon(painterResource(R.drawable.ic_folder), contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                    supporting = { MonoPath(shortPath(folder, home)) },
                ) {
                    Text(lastComponent(folder), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                }
            }
        }
    }
}
