package com.muzammil.broski.feature.workspace.git

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.DiffRoute
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.lastComponent
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitDiffRead

/** One file's diff: staged against HEAD, or the work tree against what is staged. */
@Composable
fun DiffScreen(context: FeatureContext, route: DiffRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val viewModel = viewModel(key = "diff:${route.machineId}:${route.cwd}:${route.path}:${route.staged}") {
            DiffViewModel(WorkspaceClient(machine::request), route.cwd, route.path, route.staged)
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        var wrap by rememberSaveable { mutableStateOf(false) }
        val where = stringResource(if (route.staged) R.string.diff_staged else R.string.diff_unstaged)
        Scaffold(
            topBar = {
                PathTopBar(lastComponent(route.path), where, context.back) {
                    IconToggleButton(checked = wrap, onCheckedChange = { wrap = it }) {
                        Icon(painterResource(R.drawable.ic_wrap_text), contentDescription = stringResource(R.string.file_wrap_lines))
                    }
                }
            },
        ) { padding ->
            Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
                MachineBanner(machineState)
                when (val current = state) {
                    DiffUiState.Loading -> WorkspaceLoading()
                    is DiffUiState.Failed -> FailureMessage(current.failure, viewModel::reload, notFound = R.string.git_not_a_repository)
                    is DiffUiState.Shown -> DiffBody(current.diff, wrap, padding.calculateBottomPadding())
                }
            }
        }
    }
}

@Composable
private fun DiffBody(diff: GitDiffRead, wrap: Boolean, bottom: Dp) {
    val file = diff.files.firstOrNull()
    when {
        file == null -> EmptyState(stringResource(R.string.diff_none_title), stringResource(R.string.diff_none_body))
        file.binary -> EmptyState(stringResource(R.string.diff_binary_title), stringResource(R.string.diff_binary_body))
        file.change == GitChange.CONFLICTED && file.hunks.isEmpty() ->
            EmptyState(stringResource(R.string.diff_conflicted_title), stringResource(R.string.diff_conflicted_body))
        else -> DiffText(
            file = file,
            wrap = wrap,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = 8.dp, bottom = bottom + 24.dp),
            header = {
                file.previousPath?.let { previous -> item(key = "renamed") { Banner(stringResource(R.string.diff_renamed, previous)) } }
                if (diff.truncated) item(key = "truncated") { Banner(stringResource(R.string.diff_truncated)) }
            },
        )
    }
}

@Composable
private fun Banner(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
    }
}
