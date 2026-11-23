package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import com.muzammil.broski.feature.workspace.WorkspaceBanner
import com.muzammil.broski.feature.workspace.WorkspaceType
import com.muzammil.broski.feature.workspace.git.summary
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.relativeTime
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import com.muzammil.broski.feature.workspace.git.SHORT_HASH
import com.muzammil.broski.feature.workspace.lastComponent
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import uniffi.broski_contract.GitStatusRead
import uniffi.broski_contract.TerminalStatus
import uniffi.broski_contract.TerminalSummary

/** What a folder holds besides its files: the repository it lies in, and the terminals opened in it or below. */
data class FolderOverview(
    val repository: GitStatusRead? = null,
    val terminals: List<TerminalSummary> = emptyList(),
    /** A terminal that did not close. */
    val closeFailure: WorkspaceFailure? = null,
    /** The folder with its links resolved, as a terminal opened here spells it. */
    val canonical: String? = null,
)

class FolderOverviewViewModel(private val client: WorkspaceClient, private val path: String) : ViewModel() {
    private val mutableState = MutableStateFlow(FolderOverview())
    val state: StateFlow<FolderOverview> = mutableState.asStateFlow()

    /** The folder with its links resolved, as the bridge spells a terminal's: one opened here names it so. */
    private var canonical: String? = null

    /**
     * Read each time the folder shows, since the person may come back from a terminal opened here.
     * A read that does not come keeps what was shown: the files are what the screen is for.
     */
    fun refresh(canonicalPath: String?): Job {
        canonical = canonicalPath
        mutableState.update { it.copy(canonical = canonicalPath) }
        val repository = viewModelScope.launch {
            when (val answer = client.status(path)) {
                is Answer.Done -> mutableState.update { it.copy(repository = answer.value) }
                is Answer.Failed -> if (answer.failure.reason == WorkspaceFailure.Reason.NotFound) mutableState.update { it.copy(repository = null) }
            }
        }
        val terminals = viewModelScope.launch { readTerminals() }
        return viewModelScope.launch { joinAll(repository, terminals) }
    }

    /** Ends the terminal's program on the Mac if it still runs, and forgets it. */
    fun close(id: String) {
        viewModelScope.launch {
            val failure = (client.closeTerminal(id) as? Answer.Failed)?.failure
            mutableState.update { it.copy(closeFailure = failure) }
            readTerminals()
        }
    }

    private suspend fun readTerminals() {
        val answer = client.terminals() as? Answer.Done ?: return
        mutableState.update { it.copy(terminals = terminalsWithin(listOfNotNull(path, canonical), answer.value)) }
    }
}

/** The terminals whose folder is one of [folders] or lies under it, newest first; `/work` is not under `/w`. */
fun terminalsWithin(folders: List<String>, terminals: List<TerminalSummary>): List<TerminalSummary> =
    terminals.filter { terminal -> folders.any { terminal.cwd.isWithin(it) } }.sortedByDescending { it.createdAt }

private fun String.isWithin(folder: String): Boolean = this == folder || startsWith(folder.trimEnd('/') + "/")

/** The repository row and the terminals, as groups above the folder's entries. */
fun LazyListScope.folderOverview(
    overview: FolderOverview,
    folder: String,
    onGit: () -> Unit,
    onTerminal: (TerminalSummary) -> Unit,
    onClose: (TerminalSummary) -> Unit,
) {
    overview.repository?.let { status ->
        item(key = "repository", contentType = "repository") { RepositoryRow(status, onGit) }
        item(key = "repository-gap", contentType = "gap") { Spacer(Modifier.height(GROUP_GAP)) }
    }
    if (overview.terminals.isEmpty()) return
    item(key = "terminals", contentType = "header") { SectionHeader(stringResource(R.string.workspace_terminals)) }
    overview.closeFailure?.let { failure ->
        item(key = "close-failure", contentType = "banner") { WorkspaceBanner(failure, Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
    }
    val place = { terminal: TerminalSummary -> if (terminal.cwd.isWithin(folder)) folder else overview.canonical ?: folder }
    itemsIndexed(overview.terminals, key = { _, terminal -> "terminal:${terminal.id}" }, contentType = { _, _ -> "terminal" }) { index, terminal ->
        TerminalRow(terminal, place(terminal), index, overview.terminals.size, { onTerminal(terminal) }, { onClose(terminal) })
    }
    item(key = "terminals-gap", contentType = "gap") { Spacer(Modifier.height(GROUP_GAP)) }
}

val GROUP_GAP = 16.dp

@Composable
private fun RepositoryRow(status: GitStatusRead, onOpen: () -> Unit) {
    val changes = status.staged.size + status.unstaged.size + status.untracked.size
    val changed = if (changes == 0) stringResource(R.string.workspace_no_changes) else pluralStringResource(R.plurals.workspace_changes, changes, changes)
    val detail = status.upstream?.let { stringResource(R.string.workspace_repository_upstream, changed, it.summary()) }
        ?: stringResource(R.string.workspace_repository, changed)
    GroupedRow(
        index = 0,
        count = 1,
        onClick = onOpen,
        leading = { Icon(painterResource(R.drawable.ic_call_split), contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
        supporting = { Text(detail, style = WorkspaceType.footnote) },
    ) {
        Text(
            status.branch ?: stringResource(R.string.git_detached, status.head?.take(SHORT_HASH) ?: stringResource(R.string.git_detached_no_commit)),
            style = WorkspaceType.bodySemibold,
            maxLines = 1,
            overflow = TextOverflow.MiddleEllipsis,
        )
    }
}

@Composable
private fun TerminalRow(terminal: TerminalSummary, base: String, index: Int, count: Int, onOpen: () -> Unit, onClose: () -> Unit) {
    val running = terminal.status == TerminalStatus.RUNNING
    val state = when {
        running -> stringResource(R.string.terminal_running)
        terminal.signal != null -> stringResource(R.string.terminal_exited_signal, terminal.signal!!)
        else -> stringResource(R.string.terminal_row_exited, terminal.exitCode ?: 0)
    }
    val detail = stringResource(R.string.terminal_row_detail, state, terminal.cols, terminal.rows, relativeTime(terminal.createdAt))
    val place = if (terminal.cwd == base) lastComponent(base) else terminal.cwd.removePrefix(base.trimEnd('/') + "/")
    var menu by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    GroupedRow(
        index = index,
        count = count,
        onClick = onOpen,
        onLongClick = {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            menu = true
        },
        leading = {
            Icon(
                painterResource(R.drawable.ic_terminal),
                contentDescription = null,
                tint = if (running) BroskiTheme.semantic.highlight else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        supporting = { Text(detail, style = WorkspaceType.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailing = {
            IconButton(onClick = onClose) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.terminal_close))
            }
        },
    ) {
        Box {
            Text(place, style = WorkspaceType.bodyMedium, maxLines = 1, overflow = TextOverflow.StartEllipsis)
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.terminal_close), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_close), contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                    onClick = {
                        menu = false
                        onClose()
                    },
                )
            }
        }
    }
}
