package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.app.FilesRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.app.TerminalRoute
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.sentence
import com.muzammil.broski.feature.workspace.terminal.CloseTerminalDialog
import com.muzammil.broski.feature.workspace.terminal.rememberTerminalOpener
import kotlinx.coroutines.launch
import uniffi.broski_contract.FileKind
import uniffi.broski_contract.TerminalSummary

/**
 * One folder of a Mac: the repository it lies in and the terminals opened in it, then its entries a
 * page at a time, search by name under the bar, and a terminal opened here. Loading, a failure, the
 * entries and the matches all show in one list under a search field that stays put.
 */
@Composable
fun FilesScreen(context: FeatureContext, route: FilesRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val viewModel = viewModel(key = "files:${route.machineId}:${route.path}") {
            FilesViewModel(WorkspaceClient(machine::request), route.path)
        }
        val overview = viewModel(key = "overview:${route.machineId}:${route.path}") {
            FolderOverviewViewModel(WorkspaceClient(machine::request), route.path)
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
            onOpenTerminal = { context.navigate(TerminalRoute(route.machineId, it.id, it.cwd)) },
        )
        FilesScaffold(route, viewModel, overview, machineState, snackbar, actions)
    }
}

class FolderActions(
    val onBack: () -> Unit,
    val onOpen: (path: String, kind: FileKind) -> Unit,
    val onGit: () -> Unit,
    val onTerminal: () -> Unit,
    val onOpenTerminal: (TerminalSummary) -> Unit,
)

@Composable
private fun FilesScaffold(
    route: FilesRoute,
    viewModel: FilesViewModel,
    overview: FolderOverviewViewModel,
    machineState: MachineState,
    snackbar: SnackbarHostState,
    actions: FolderActions,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val here by overview.state.collectAsStateWithLifecycle()
    var closing by rememberSaveable { mutableStateOf<String?>(null) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    val copy = rememberCopier()
    LaunchedEffect(overview, state.canonicalPath) { overview.refresh(state.canonicalPath) }
    TerminalClosedHaptic(here.terminals.size)
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        containerColor = Grouped.screen,
        topBar = {
            PathTopBar(lastComponent(route.path), route.path, actions.onBack, scrollBehavior, containerColor = Grouped.screen) {
                FolderMenu(
                    showHidden = state.showHidden,
                    reachable = machineState.health.isOnline,
                    onShowHidden = viewModel::showHidden,
                    onCopyPath = { copy(route.path) },
                    onTerminal = actions.onTerminal,
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
            MachineBanner(machineState)
            SearchField(state.query, viewModel::search, stringResource(R.string.files_search_prompt, lastComponent(route.path)))
            RefreshableFolder(state, here, route.path, viewModel, overview, actions, padding.calculateBottomPadding()) { closing = it.id }
        }
    }
    closing?.let { id ->
        CloseTerminalDialog(
            onClose = {
                closing = null
                overview.close(id)
            },
            onDismiss = { closing = null },
        )
    }
}

/** The folder's list and what stands in for it, pulled down to read the entries, the repository and the terminals again. */
@Composable
private fun ColumnScope.RefreshableFolder(
    state: FilesUiState,
    here: FolderOverview,
    folder: String,
    viewModel: FilesViewModel,
    overview: FolderOverviewViewModel,
    actions: FolderActions,
    bottom: Dp,
    onClose: (TerminalSummary) -> Unit,
) {
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch {
                viewModel.reload().join()
                overview.refresh(viewModel.state.value.canonicalPath).join()
                refreshing = false
            }
        },
        modifier = Modifier.weight(1f),
    ) {
        val bare = here.repository == null && here.terminals.isEmpty()
        FolderList(state, here, folder, bare, viewModel, actions, bottom, onClose)
        FolderPlaceholder(state, bare, viewModel::reload)
    }
}

/** A terminal that is gone from the list was closed: the warning haptic of a destructive act that happened. */
@Composable
private fun TerminalClosedHaptic(count: Int) {
    val haptics = LocalHapticFeedback.current
    var seen by remember { mutableIntStateOf(count) }
    LaunchedEffect(count) {
        if (count < seen) haptics.perform(Haptic.Warning)
        seen = count
    }
}
