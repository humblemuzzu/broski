package com.muzammil.broski.feature.workspace

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FilesRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.mono
import com.muzammil.broski.feature.workspace.files.MonoPath
import com.muzammil.broski.feature.workspace.git.SHORT_HASH
import com.muzammil.broski.feature.workspace.terminal.TerminalsSection
import com.muzammil.broski.feature.workspace.terminal.rememberTerminalOpener
import kotlinx.coroutines.launch
import uniffi.broski_core.Machine

@Composable
fun WorkspaceTabContent(context: FeatureContext, machine: Machine, machineState: MachineState, tab: WorkspaceTab, snackbar: SnackbarHostState) {
    val rows by context.phone.inboxRows.collectAsStateWithLifecycle()
    val recent = remember(rows, machineState.id) { rows.filter { it.machineId == machineState.id }.mapNotNull { it.cwd }.distinct() }
    val viewModel = viewModel(key = "workspace:${machineState.id}") { WorkspaceViewModel(WorkspaceClient(machine::request), recent) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val openTerminal = rememberTerminalOpener(machine, machineState.id, context.navigate) { failure ->
        scope.launch { snackbar.showSnackbar(failure.sentence(resources)) }
    }
    val info = state.info
    if (info == null) {
        state.infoFailure?.let { FailureMessage(it, viewModel::reload) } ?: WorkspaceLoading()
        return
    }
    val home = info.roots.firstOrNull()
    val (roots, others) = state.folders(recent)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { MachineBanner(machineState) }
        when (tab) {
            WorkspaceTab.Files -> {
                folders(R.string.workspace_folders, roots, home) { context.navigate(FilesRoute(machineState.id, it)) }
                folders(R.string.workspace_recent_folders, others, home) { context.navigate(FilesRoute(machineState.id, it)) }
            }
            WorkspaceTab.Git -> repositories(info.git, state.repositories, home) { context.navigate(GitRoute(machineState.id, it)) }
            WorkspaceTab.Terminal -> item {
                TerminalsSection(context, machineState.id, info.terminal, state, roots + others, home, viewModel, openTerminal)
            }
        }
    }
    LaunchedEffect(tab) { if (tab == WorkspaceTab.Terminal) viewModel.refreshTerminals() }
}

private fun LazyListScope.folders(title: Int, paths: List<String>, home: String?, onOpen: (String) -> Unit) {
    if (paths.isEmpty()) return
    item(key = "header:$title") { SectionHeader(stringResource(title)) }
    itemsIndexed(paths, key = { _, path -> "$title:$path" }) { index, path ->
        GroupedRow(
            index = index,
            count = paths.size,
            onClick = { onOpen(path) },
            leading = { Icon(painterResource(R.drawable.ic_folder), contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
            supporting = { MonoPath(shortPath(path, home)) },
            trailing = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
        ) {
            Text(lastComponent(path), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        }
    }
}

private fun LazyListScope.repositories(git: Boolean, repositories: List<Repository>?, home: String?, onOpen: (String) -> Unit) {
    when {
        !git -> item { EmptyState(stringResource(R.string.workspace_no_git_title), stringResource(R.string.workspace_no_git_body)) }
        repositories == null -> item { WorkspaceLoading(Modifier.padding(32.dp)) }
        repositories.isEmpty() -> item {
            EmptyState(stringResource(R.string.workspace_no_repositories_title), stringResource(R.string.workspace_no_repositories_body))
        }
        else -> {
            item(key = "header:repositories") { SectionHeader(stringResource(R.string.workspace_repositories)) }
            itemsIndexed(repositories, key = { _, repository -> repository.root }) { index, repository ->
                RepositoryRow(repository, index, repositories.size, home) { onOpen(repository.root) }
            }
        }
    }
}

@Composable
private fun RepositoryRow(repository: Repository, index: Int, count: Int, home: String?, onOpen: () -> Unit) {
    val branch = repository.branch ?: stringResource(R.string.git_detached, repository.head?.take(SHORT_HASH) ?: "—")
    GroupedRow(
        index = index,
        count = count,
        onClick = onOpen,
        leading = { Icon(painterResource(R.drawable.ic_account_tree), contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
        supporting = {
            Text("$branch · ${shortPath(repository.root, home)}", style = MaterialTheme.typography.bodySmall.mono(), maxLines = 1, overflow = TextOverflow.StartEllipsis)
        },
        trailing = {
            Text(
                if (repository.changes == 0) stringResource(R.string.workspace_clean) else pluralStringResource(R.plurals.workspace_changes, repository.changes, repository.changes),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    ) {
        Text(lastComponent(repository.root), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
    }
}
