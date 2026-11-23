package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.feature.workspace.ContentUnavailable
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.WorkspaceBanner
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.WorkspaceType
import com.muzammil.broski.feature.workspace.childPath
import uniffi.broski_contract.FileEntry
import uniffi.broski_contract.FileKind
import uniffi.broski_contract.TerminalSummary

/** The one list of a folder: what sits above its entries, the entries or the matches, and what follows them. */
@Composable
fun FolderList(
    state: FilesUiState,
    overview: FolderOverview,
    folder: String,
    bare: Boolean,
    viewModel: FilesViewModel,
    actions: FolderActions,
    bottom: Dp,
    onClose: (TerminalSummary) -> Unit,
) {
    val loaded = state.entries.isNotEmpty() || (!state.loading && state.failure == null)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = bottom + 24.dp)) {
        val matches = state.matches
        when {
            !loaded -> Unit
            matches != null -> matchRows(state, matches, folder, actions)
            else -> {
                folderOverview(overview, folder, actions.onGit, actions.onOpenTerminal, onClose)
                entryRows(state, folder, bare, viewModel, actions)
            }
        }
    }
}

private fun LazyListScope.entryRows(state: FilesUiState, folder: String, bare: Boolean, viewModel: FilesViewModel, actions: FolderActions) {
    val entries = state.entries
    if (entries.isEmpty() && state.nextCursor == null && !bare) {
        item(key = "nothing", contentType = "nothing") {
            GroupedRow(index = 0, count = 1, onClick = null) {
                Text(stringResource(R.string.files_nothing_here), style = WorkspaceType.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    itemsIndexed(entries, key = { _, entry -> entry.name }, contentType = { _, _ -> "entry" }) { index, entry ->
        val path = childPath(folder, entry.name)
        EntryRow(
            entry = entry,
            path = path,
            index = index,
            count = entries.size,
            onOpen = { actions.onOpen(path, entry.kind) },
            onOpenAsFolder = { actions.onOpen(path, FileKind.DIR) },
            modifier = Modifier.animateItem(),
        )
    }
    val pageFailure = state.pageFailure
    when {
        pageFailure != null -> item(key = "page-failure", contentType = "page-failure") {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                WorkspaceBanner(pageFailure)
                TextButton(onClick = viewModel::loadMore) { Text(stringResource(R.string.files_load_more), style = WorkspaceType.subheadlineSemibold) }
            }
        }
        state.nextCursor != null -> item(key = "more", contentType = "more") {
            LaunchedEffect(entries.size) { viewModel.loadMore() }
            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { LoadingOrb() }
        }
    }
}

private fun LazyListScope.matchRows(state: FilesUiState, matches: List<uniffi.broski_contract.FileMatch>, folder: String, actions: FolderActions) {
    state.searchFailure?.let { failure ->
        item(key = "search-failure", contentType = "page-failure") { WorkspaceBanner(failure, Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
    }
    itemsIndexed(matches, key = { _, match -> match.path }, contentType = { _, _ -> "entry" }) { index, match ->
        val path = childPath(folder, match.path)
        EntryRow(
            entry = FileEntry(match.path, match.kind, null, null),
            path = path,
            index = index,
            count = matches.size,
            onOpen = { actions.onOpen(path, match.kind) },
            onOpenAsFolder = { actions.onOpen(path, FileKind.DIR) },
        )
    }
}

/** What fills the screen when there is nothing to list: the orb, the failure, no matches, or an empty folder. */
@Composable
fun FolderPlaceholder(state: FilesUiState, bare: Boolean, onRetry: () -> Unit) {
    val matches = state.matches
    val failure = state.failure
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            state.loading && state.entries.isEmpty() -> WorkspaceLoading()
            failure != null && state.entries.isEmpty() -> FailureMessage(failure, onRetry, notFound = R.string.files_not_found)
            matches != null ->
                if (matches.isEmpty() && state.searchFailure == null) {
                    ContentUnavailable(
                        icon = R.drawable.ic_search,
                        title = stringResource(R.string.files_search_none_title, state.query.trim()),
                        description = stringResource(R.string.files_search_none_body),
                    )
                }
            state.entries.isEmpty() && state.nextCursor == null && bare ->
                ContentUnavailable(icon = R.drawable.ic_folder, title = stringResource(R.string.files_empty_title))
        }
    }
}
