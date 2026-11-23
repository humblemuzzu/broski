package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.WorkspaceType
import uniffi.broski_contract.GitBranch

/** Every branch, the current one checked; tapping another asks before switching to it. */
@Composable
fun BranchesScreen(
    state: GitUiState,
    viewModel: GitViewModel,
    reachable: Boolean,
    snackbar: SnackbarHostState,
    onBack: () -> Unit,
) {
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { viewModel.loadBranches() }
    Scaffold(
        containerColor = Grouped.screen,
        topBar = { PathTopBar(stringResource(R.string.git_branches), null, onBack, containerColor = Grouped.screen) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
            val branches = state.branches
            when {
                branches == null -> WorkspaceLoading()
                state.branchesFailure != null -> FailureMessage(state.branchesFailure, viewModel::loadBranches)
                else -> PullToRefreshBox(isRefreshing = false, onRefresh = viewModel::loadBranches) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = padding.calculateBottomPadding() + 24.dp)) {
                        branchSection(R.string.git_branches_local, branches.filter { !it.remote }, state, reachable) { picked = it.name }
                        branchSection(R.string.git_branches_remote, branches.filter { it.remote }, state, reachable) { picked = it.name }
                        if (state.branchesTruncated) item(key = "truncated") { BranchesTruncated() }
                    }
                }
            }
        }
    }
    val target = picked?.let { name -> state.branches?.firstOrNull { it.name == name } }
    if (target != null) {
        AlertDialog(
            onDismissRequest = { picked = null },
            title = { Text(stringResource(R.string.git_checkout_title, checkoutName(target))) },
            text = { Text(stringResource(R.string.git_checkout_body)) },
            confirmButton = {
                TextButton(onClick = {
                    picked = null
                    viewModel.checkout(target)
                }) { Text(stringResource(R.string.git_checkout)) }
            },
            dismissButton = { TextButton(onClick = { picked = null }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

private fun LazyListScope.branchSection(
    title: Int,
    branches: List<GitBranch>,
    state: GitUiState,
    reachable: Boolean,
    onPick: (GitBranch) -> Unit,
) {
    if (branches.isEmpty()) return
    item(key = "header:$title", contentType = "header") { SectionHeader(stringResource(title)) }
    itemsIndexed(branches, key = { _, branch -> "${branch.remote}:${branch.name}" }, contentType = { _, _ -> "branch" }) { index, branch ->
        BranchItem(branch, index, branches.size, switching = state.switching == branch.name, enabled = reachable && !state.busy) { onPick(branch) }
    }
}

@Composable
private fun BranchItem(branch: GitBranch, index: Int, count: Int, switching: Boolean, enabled: Boolean, onPick: () -> Unit) {
    val upstream = branch.upstream?.summary()
    GroupedRow(
        index = index,
        count = count,
        onClick = if (branch.current || !enabled) null else onPick,
        supporting = upstream?.let { { Text(it, style = WorkspaceType.footnote) } },
        trailing = {
            when {
                switching -> LoadingOrb(state = OrbState.WORKING, label = stringResource(R.string.git_switching))
                branch.current -> Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
        },
    ) {
        Text(branch.name, style = WorkspaceType.body)
    }
}

@Composable
private fun BranchesTruncated() {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(stringResource(R.string.git_branches_truncated), style = WorkspaceType.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
