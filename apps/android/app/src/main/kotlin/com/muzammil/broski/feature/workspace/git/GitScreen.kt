package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.DiffRoute
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceLoading
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
            topBar = {
                PathTopBar(lastComponent(root), root, context.back) {
                    IconButton(onClick = { branchesOpen = true }, enabled = state.status != null) {
                        Icon(painterResource(R.drawable.ic_call_split), contentDescription = stringResource(R.string.git_branches))
                    }
                }
            },
            bottomBar = {
                if (state.status?.staged?.isNotEmpty() == true) CommitBar(state, viewModel::editMessage, viewModel::commit)
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
                MachineBanner(machineState)
                GitBody(state, viewModel, openRow, PaddingValues(top = 8.dp, bottom = padding.calculateBottomPadding() + 24.dp))
            }
        }
        if (branchesOpen) BranchesSheet(state, viewModel, onDismiss = { branchesOpen = false })
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
private fun GitBody(state: GitUiState, viewModel: GitViewModel, onOpen: (ChangeRow) -> Unit, contentPadding: PaddingValues) {
    val status = state.status
    when {
        status == null && state.loading -> WorkspaceLoading()
        status == null -> FailureMessage(state.failure ?: return, viewModel::refresh, notFound = R.string.git_not_a_repository)
        else -> PullToRefreshBox(isRefreshing = state.busy, onRefresh = viewModel::refresh) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = contentPadding) {
                item(key = "branch", contentType = "branch") { BranchHeader(status) }
                if (state.sections.isEmpty()) item(key = "clean", contentType = "clean") { CleanTree() }
                state.sections.forEach { section -> changes(section, state.busy, viewModel, onOpen) }
                if (state.log.isNotEmpty()) log(state)
            }
        }
    }
}

private fun LazyListScope.changes(section: ChangeSection, busy: Boolean, viewModel: GitViewModel, onOpen: (ChangeRow) -> Unit) {
    item(key = "section:${section.area}", contentType = "header") {
        SectionTitle(section, enabled = !busy) {
            if (section.area == Area.Staged) viewModel.unstage(listOf(".")) else viewModel.stage(section.rows.map { it.path })
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
