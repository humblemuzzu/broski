package com.muzammil.broski.feature.newsession

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.mono
import com.muzammil.broski.feature.workspace.childPath
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.parentPath

/**
 * The folder for the session, in the same sheet: the folders recent sessions ran in, then the
 * machine's folders to browse from its roots. "Use this folder" picks the one shown.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
internal fun ColumnScope.FolderPicker(listing: FolderListing, model: NewSessionViewModel) {
    val ui by model.state.collectAsStateWithLifecycle()
    val machineId = ui.choice.machineId ?: return
    val pick: (String) -> Unit = { path ->
        model.pickFolder(path)
        model.folders.close()
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = model.folders::close) {
            Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
        }
        Text(stringResource(R.string.new_session_pick_folder), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
    }
    LazyColumn(Modifier.weight(1f)) {
        if (ui.recentFolders.isNotEmpty()) {
            item(key = "recent") { SectionHeader(stringResource(R.string.new_session_recent_folders)) }
            items(ui.recentFolders, key = { "recent:$it" }) { path -> FolderRow(lastComponent(path), path) { pick(path) } }
        }
        item(key = "browse") { SectionHeader(listing.path, Modifier) }
        if (listing.path !in listing.roots) {
            item(key = "up") { FolderRow("..", null) { model.folders.open(machineId, parentPath(listing.path)) } }
        }
        when {
            listing.loading -> item(key = "loading") { Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) { LoadingIndicator() } }
            listing.failure != null -> item(key = "failure") {
                Text(stringResource(listing.failure.reason.sentence), modifier = Modifier.padding(24.dp))
            }
            else -> items(listing.folders, key = { "dir:$it" }) { name ->
                FolderRow(name, null) { model.folders.open(machineId, childPath(listing.path, name)) }
            }
        }
    }
    Button(
        onClick = { pick(listing.path) },
        shapes = ButtonDefaults.shapes(),
        modifier = Modifier.fillMaxWidth().padding(16.dp),
    ) { Text(stringResource(R.string.new_session_use_folder, lastComponent(listing.path))) }
}

@Composable
private fun FolderRow(name: String, path: String?, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(name, maxLines = 1, overflow = TextOverflow.MiddleEllipsis) },
        supportingContent = path?.let { { Text(it, style = MaterialTheme.typography.bodySmall.mono(), maxLines = 1, overflow = TextOverflow.StartEllipsis) } },
        leadingContent = { Icon(painterResource(R.drawable.ic_folder), contentDescription = null) },
        modifier = Modifier.clickable(onClick = onClick),
    )
}
