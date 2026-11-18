package com.muzammil.broski.feature.newsession

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.childPath
import com.muzammil.broski.feature.workspace.files.FilesViewModel
import com.muzammil.broski.feature.workspace.files.MonoPath
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.parentPath
import com.muzammil.broski.feature.workspace.shortPath
import uniffi.broski_contract.FileKind
import uniffi.broski_core.Machine

/**
 * Every folder this Mac's sessions ran in, by any agent, with a search; and Choose folder… to go anywhere
 * on the Mac from home, a folder at a time, back the way it came.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProjectsSheet(
    machine: Machine,
    machineId: String,
    projects: List<Project>,
    selected: String?,
    home: String?,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var trail by rememberSaveable { mutableStateOf(emptyList<String>()) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        AnimatedContent(trail.lastOrNull(), transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "folder") { folder ->
            Column(Modifier.fillMaxSize().imePadding()) {
                if (folder == null) {
                    ProjectsPage(projects, selected, home, onPick) { trail = listOf(home ?: "/") }
                } else {
                    BackHandler { trail = trail.dropLast(1) }
                    FolderPage(
                        machine = machine,
                        machineId = machineId,
                        path = folder,
                        home = home,
                        onOpen = { trail = trail + it },
                        onBack = { trail = trail.dropLast(1) },
                        onJump = { trail = listOf(it) },
                        onSelect = onPick,
                    )
                }
            }
        }
    }
}

@Composable
private fun ProjectsPage(projects: List<Project>, selected: String?, home: String?, onPick: (String) -> Unit, onBrowse: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    val words = query.trim()
    val shown = remember(projects, words) {
        if (words.isEmpty()) projects else projects.filter { it.path.contains(words, ignoreCase = true) }
    }
    Text(
        stringResource(R.string.new_session_projects),
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp).semantics { heading() },
    )
    SearchBox(query, stringResource(R.string.new_session_search_projects)) { query = it }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp)) {
        item(key = "choose") {
            GroupedRow(
                index = 0,
                count = 1,
                onClick = onBrowse,
                leading = { Icon(painterResource(R.drawable.ic_folder_open), contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                trailing = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
            ) { Text(stringResource(R.string.new_session_choose_folder)) }
        }
        if (shown.isNotEmpty()) {
            item(key = "recent") { SectionHeader(stringResource(R.string.new_session_recent_folders)) }
            itemsIndexed(shown, key = { _, project -> project.path }) { index, project ->
                GroupedRow(
                    index = index,
                    count = shown.size,
                    onClick = { onPick(project.path) },
                    supporting = { MonoPath(shortPath(project.path, home)) },
                    trailing = if (project.path == selected) ({ Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = MaterialTheme.colorScheme.primary) }) else null,
                ) { Text(lastComponent(project.path), maxLines = 1, overflow = TextOverflow.MiddleEllipsis) }
            }
        } else if (words.isNotEmpty()) {
            item(key = "none") { EmptyState(stringResource(R.string.new_session_no_projects_title), stringResource(R.string.new_session_no_projects_body, words)) }
        }
    }
}

/** One folder of the Mac: the folders in it a page at a time, a search for folders below it, the folders above it, and Select. */
@Composable
private fun FolderPage(
    machine: Machine,
    machineId: String,
    path: String,
    home: String?,
    onOpen: (String) -> Unit,
    onBack: () -> Unit,
    onJump: (String) -> Unit,
    onSelect: (String) -> Unit,
) {
    val folder = viewModel(key = "pick:$machineId:$path") { FilesViewModel(WorkspaceClient(machine::request), path) }
    val state by folder.state.collectAsStateWithLifecycle()
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) {
            Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
        }
        PlacesTitle(path, home, onJump, Modifier.weight(1f))
        FilledTonalButton(onClick = { onSelect(path) }) { Text(stringResource(R.string.new_session_select)) }
    }
    MonoPath(shortPath(path, home), Modifier.padding(horizontal = 24.dp))
    SearchBox(state.query, stringResource(R.string.new_session_search_folders, lastComponent(path)), folder::search)
    val matches = state.matches
    val failure = state.failure
    when {
        matches != null -> FolderList(
            names = matches.filter { it.kind == FileKind.DIR }.map { it.path },
            cursor = null,
            failure = state.searchFailure,
            onNearEnd = {},
            onOpen = { onOpen(childPath(path, it)) },
            empty = { EmptyState(stringResource(R.string.files_search_none_title), stringResource(R.string.files_search_none_body, state.query)) },
        )
        state.loading -> WorkspaceLoading()
        failure != null && state.entries.isEmpty() -> FailureMessage(failure, folder::reload)
        else -> FolderList(
            names = state.entries.filter { it.kind == FileKind.DIR || it.kind == FileKind.SYMLINK }.map { it.name },
            cursor = state.nextCursor,
            failure = failure,
            onNearEnd = folder::loadMore,
            onOpen = { onOpen(childPath(path, it)) },
            empty = { EmptyState(stringResource(R.string.new_session_no_folders_title), stringResource(R.string.new_session_no_folders_body, lastComponent(path))) },
        )
    }
}

/** The folder's name, a menu of the folders above it, nearest first, and home when it is not one of them. */
@Composable
private fun PlacesTitle(path: String, home: String?, onJump: (String) -> Unit, modifier: Modifier) {
    var open by remember { mutableStateOf(false) }
    val above = remember(path) { generateSequence(path) { if (it == "/") null else parentPath(it) }.drop(1).toList() }
    Box(modifier) {
        TextButton(onClick = { open = true }, enabled = above.isNotEmpty() || (home != null && home != path)) {
            Text(lastComponent(path), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
            Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = stringResource(R.string.new_session_places))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            above.forEach { place ->
                DropdownMenuItem(
                    text = { Text(lastComponent(place)) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_folder), contentDescription = null) },
                    onClick = {
                        open = false
                        onJump(place)
                    },
                )
            }
            if (home != null && home != path && home !in above) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.new_session_home)) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_folder_open), contentDescription = null) },
                    onClick = {
                        open = false
                        onJump(home)
                    },
                )
            }
        }
    }
}

/**
 * Folders a page at a time. The pages are of every entry and the list shows only folders, so a page of
 * files adds no row: the next page is asked for by its [cursor], which every page moves on.
 */
@Composable
private fun FolderList(
    names: List<String>,
    cursor: String?,
    failure: WorkspaceFailure?,
    onNearEnd: () -> Unit,
    onOpen: (String) -> Unit,
    empty: @Composable () -> Unit,
) {
    val hasMore = cursor != null
    if (names.isEmpty() && !hasMore) {
        failure?.let { FailureMessage(it, onRetry = null) } ?: empty()
        return
    }
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - PAGE_AHEAD } }
    LaunchedEffect(nearEnd, cursor, failure) { if (nearEnd && hasMore && failure == null) onNearEnd() }
    LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp)) {
        itemsIndexed(names, key = { _, name -> name }) { index, name ->
            GroupedRow(
                index = index,
                count = names.size,
                onClick = { onOpen(name) },
                leading = { Icon(painterResource(R.drawable.ic_folder), contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                trailing = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
            ) { Text(name, maxLines = 1, overflow = TextOverflow.MiddleEllipsis) }
        }
        when {
            failure != null && hasMore -> item(key = "failure") { FailureMessage(failure, onNearEnd) }
            hasMore -> item(key = "more") { WorkspaceLoading(Modifier.padding(16.dp)) }
        }
    }
}

@Composable
private fun SearchBox(query: String, placeholder: String, onQuery: (String) -> Unit) {
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null) },
        singleLine = true,
        shape = CircleShape,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

private const val PAGE_AHEAD = 20
