package com.muzammil.broski.feature.workspace.git

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.DiffRoute
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.workspace.ContentUnavailable
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.WorkspaceType
import com.muzammil.broski.feature.workspace.childPath
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.sentence

/** A repository on a Mac: branch, what changed, staging by swipe, a commit, branches and recent commits. */
@Composable
fun GitScreen(context: FeatureContext, route: GitRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val viewModel = viewModel(key = "git:${route.machineId}:${route.cwd}") {
            GitViewModel(WorkspaceClient(machine::request), route.cwd)
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        val snackbar = remember { SnackbarHostState() }
        var branchesOpen by rememberSaveable { mutableStateOf(false) }
        GitEvents(viewModel, snackbar)
        if (branchesOpen) {
            BackHandler { branchesOpen = false }
            BranchesScreen(state, viewModel, machineState.health.isOnline, snackbar) { branchesOpen = false }
        } else {
            GitContent(route, state, viewModel, machineState, snackbar, context) { branchesOpen = true }
        }
    }
}

@Composable
private fun GitContent(
    route: GitRoute,
    state: GitUiState,
    viewModel: GitViewModel,
    machineState: MachineState,
    snackbar: SnackbarHostState,
    context: FeatureContext,
    onBranches: () -> Unit,
) {
    val root = state.status?.root ?: route.cwd
    val openRow = { row: ChangeRow ->
        context.navigate(
            if (row.area == Area.Untracked) {
                FileRoute(route.machineId, childPath(root, row.path))
            } else {
                DiffRoute(route.machineId, root, row.path, staged = row.area == Area.Staged)
            },
        )
    }
    Scaffold(
        containerColor = Grouped.screen,
        topBar = { PathTopBar(stringResource(R.string.git_title), null, context.back, containerColor = Grouped.screen) },
        bottomBar = {
            if (state.status != null) CommitBar(state, machineState.health.isOnline, viewModel::editMessage, viewModel::commit)
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        androidx.compose.foundation.layout.Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
            MachineBanner(machineState)
            GitBody(state, viewModel, route.cwd, openRow, onBranches, PaddingValues(top = 8.dp, bottom = padding.calculateBottomPadding() + 24.dp))
        }
    }
}

@Composable
private fun GitEvents(viewModel: GitViewModel, snackbar: SnackbarHostState) {
    val haptics = LocalHapticFeedback.current
    val resources = LocalResources.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            val text = when (event) {
                is GitEvent.Committed -> {
                    haptics.perform(Haptic.Success)
                    resources.getString(R.string.git_committed, event.commit.hash.take(SHORT_HASH), event.commit.subject)
                }
                is GitEvent.CheckedOut -> {
                    haptics.perform(Haptic.Success)
                    resources.getString(R.string.git_checked_out, event.branch)
                }
                is GitEvent.Failed -> {
                    haptics.perform(Haptic.Failure)
                    event.failure.sentence(resources)
                }
            }
            snackbar.showSnackbar(text)
        }
    }
}

@Composable
private fun GitBody(
    state: GitUiState,
    viewModel: GitViewModel,
    cwd: String,
    onOpen: (ChangeRow) -> Unit,
    onBranches: () -> Unit,
    contentPadding: PaddingValues,
) {
    val status = state.status
    val failure = state.failure
    when {
        status == null && state.loading -> WorkspaceLoading()
        status == null && failure?.reason == WorkspaceFailure.Reason.NotFound -> ContentUnavailable(
            icon = R.drawable.ic_call_split,
            title = stringResource(R.string.git_not_a_repository_title),
            description = stringResource(R.string.git_not_a_repository_body, lastComponent(cwd)),
            modifier = Modifier.fillMaxSize(),
        )
        status == null -> FailureMessage(failure ?: return, viewModel::refresh)
        else -> PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = viewModel::refresh) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = contentPadding) {
                item(key = "branch", contentType = "branch") { BranchRow(status, onBranches) }
                state.sections.forEach { section -> changes(section, state.busy, viewModel, onOpen) }
                if (state.sections.isEmpty()) item(key = "clean", contentType = "clean") { CleanTree() }
                if (status.truncated) item(key = "truncated", contentType = "note") { TruncatedStatus() }
                if (state.log.isNotEmpty()) log(state)
            }
        }
    }
}

@Composable
private fun TruncatedStatus() {
    Text(
        stringResource(R.string.git_truncated),
        style = WorkspaceType.footnote,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 32.dp, vertical = 8.dp),
    )
}

private fun LazyListScope.changes(section: ChangeSection, busy: Boolean, viewModel: GitViewModel, onOpen: (ChangeRow) -> Unit) {
    item(key = "section:${section.area}", contentType = "header") {
        SectionTitle(section, enabled = !busy) {
            if (section.area == Area.Staged) viewModel.unstage(listOf(".")) else viewModel.stage(section.rows.take(MAX_STAGE_ALL).map { it.path })
        }
    }
    itemsIndexed(section.rows, key = { _, row -> "${row.area}:${row.path}" }, contentType = { _, _ -> "change" }) { index, row ->
        ChangeItem(
            row = row,
            index = index,
            count = section.rows.size,
            enabled = !busy,
            onOpen = { onOpen(row) },
            onToggle = { if (row.area == Area.Staged) viewModel.unstage(listOf(row.path)) else viewModel.stage(listOf(row.path)) },
            modifier = Modifier.animateItem(),
        )
    }
}

private fun LazyListScope.log(state: GitUiState) {
    item(key = "log", contentType = "header") { SectionHeader(stringResource(R.string.git_recent_commits)) }
    itemsIndexed(state.log, key = { _, commit -> "commit:${commit.hash}" }, contentType = { _, _ -> "commit" }) { index, commit ->
        CommitItem(commit, index, state.log.size)
    }
}

internal const val SHORT_HASH = 7
private const val MAX_STAGE_ALL = 1000
