package com.muzammil.broski.feature.workspace.files

import android.content.ClipData
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.app.FilesRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.childPath
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.sentence
import com.muzammil.broski.feature.workspace.terminal.rememberTerminalOpener
import kotlinx.coroutines.launch
import uniffi.broski_contract.FileKind

/** One folder of a Mac: its entries, folders first, a search by name under it, and its actions. */
@Composable
fun FilesScreen(context: FeatureContext, route: FilesRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val viewModel = viewModel(key = "files:${route.machineId}:${route.path}") {
            FilesViewModel(WorkspaceClient(machine::request), route.path)
        }
        val snackbar = remember { SnackbarHostState() }
        val resources = LocalResources.current
        val scope = rememberCoroutineScope()
        val openTerminal = rememberTerminalOpener(machine, route.machineId, context.navigate) { failure ->
            scope.launch { snackbar.showSnackbar(failure.sentence(resources)) }
        }
        val actions = FolderActions(
            onBack = context.back,
            onOpen = { path, kind ->
                context.navigate(if (kind == FileKind.DIR) FilesRoute(route.machineId, path) else FileRoute(route.machineId, path))
            },
            onGit = { context.navigate(GitRoute(route.machineId, route.path)) },
            onTerminal = { openTerminal(route.path) },
        )
        FilesScaffold(route, viewModel, machineState, snackbar, actions)
    }
}

class FolderActions(
    val onBack: () -> Unit,
    val onOpen: (path: String, kind: FileKind) -> Unit,
    val onGit: () -> Unit,
    val onTerminal: () -> Unit,
)

@Composable
private fun FilesScaffold(
    route: FilesRoute,
    viewModel: FilesViewModel,
    machineState: MachineState,
    snackbar: SnackbarHostState,
    actions: FolderActions,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    val clipboard = LocalClipboard.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    var searching by rememberSaveable { mutableStateOf(false) }
    val closeSearch = {
        searching = false
        viewModel.search("")
    }
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            PathTopBar(lastComponent(route.path), route.path, actions.onBack, scrollBehavior) {
                IconButton(onClick = { if (searching) closeSearch() else searching = true }) {
                    Icon(painterResource(R.drawable.ic_search), contentDescription = stringResource(R.string.files_search))
                }
                FolderMenu(
                    showHidden = state.showHidden,
                    onShowHidden = viewModel::showHidden,
                    onCopyPath = {
                        scope.launch {
                            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(route.path, route.path)))
                            snackbar.showSnackbar(resources.getString(R.string.files_path_copied))
                        }
                    },
                    onGit = actions.onGit,
                    onTerminal = actions.onTerminal,
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
            MachineBanner(machineState)
            if (searching) SearchField(state.query, viewModel::search, onClose = closeSearch)
            FilesBody(state, route.path, viewModel, actions.onOpen, bottom = padding.calculateBottomPadding())
        }
    }
}

@Composable
private fun FilesBody(state: FilesUiState, folder: String, viewModel: FilesViewModel, onOpen: (String, FileKind) -> Unit, bottom: Dp) {
    val matches = state.matches
    when {
        matches != null -> SearchResults(state, folder, matches, onOpen, bottom)
        state.loading -> WorkspaceLoading()
        state.failure != null && state.entries.isEmpty() ->
            FailureMessage(state.failure, viewModel::reload, notFound = R.string.files_not_found)
        state.entries.isEmpty() -> EmptyState(stringResource(R.string.files_empty_title), stringResource(R.string.files_empty_body))
        else -> EntryList(state, folder, viewModel::loadMore, onOpen, bottom)
    }
}

@Composable
private fun EntryList(state: FilesUiState, folder: String, onNearEnd: () -> Unit, onOpen: (String, FileKind) -> Unit, bottom: Dp) {
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - PAGE_AHEAD
        }
    }
    LaunchedEffect(nearEnd, state.nextCursor) {
        if (nearEnd && state.nextCursor != null) onNearEnd()
    }
    val entries = state.entries
    LazyColumn(state = listState, contentPadding = PaddingValues(top = 8.dp, bottom = bottom + 24.dp)) {
        itemsIndexed(entries, key = { _, entry -> entry.name }, contentType = { _, _ -> "entry" }) { index, entry ->
            EntryRow(entry, index, entries.size, Modifier.animateItem()) { onOpen(childPath(folder, entry.name), entry.kind) }
        }
        if (state.loadingMore) item(key = "more", contentType = "more") { WorkspaceLoading(Modifier.padding(16.dp)) }
        state.failure?.let { failure ->
            item(key = "failure", contentType = "failure") { FailureMessage(failure, onNearEnd) }
        }
    }
}

@Composable
private fun SearchResults(
    state: FilesUiState,
    folder: String,
    matches: List<uniffi.broski_contract.FileMatch>,
    onOpen: (String, FileKind) -> Unit,
    bottom: Dp,
) {
    when {
        state.searchFailure != null -> FailureMessage(state.searchFailure, onRetry = null)
        matches.isEmpty() -> EmptyState(
            stringResource(R.string.files_search_none_title),
            stringResource(R.string.files_search_none_body, state.query),
        )
        else -> LazyColumn(contentPadding = PaddingValues(top = 8.dp, bottom = bottom + 24.dp)) {
            itemsIndexed(matches, key = { _, match -> match.path }) { index, match ->
                GroupedRow(
                    index = index,
                    count = matches.size,
                    onClick = { onOpen(childPath(folder, match.path), match.kind) },
                    leading = { Icon(painterResource(match.kind.icon), contentDescription = null) },
                    supporting = { MonoPath(match.path) },
                ) {
                    Text(lastComponent(match.path), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                }
            }
        }
    }
}

private const val PAGE_AHEAD = 20
