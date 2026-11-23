package com.muzammil.broski.feature.workspace.files

import android.content.ClipData
import android.text.format.Formatter
import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.relativeTime
import com.muzammil.broski.feature.workspace.WorkspaceType
import kotlinx.coroutines.launch
import uniffi.broski_contract.FileEntry
import uniffi.broski_contract.FileKind
import uniffi.broski_core.isImagePath

@get:DrawableRes
val FileKind.icon: Int
    get() = when (this) {
        FileKind.DIR -> R.drawable.ic_folder
        FileKind.SYMLINK -> R.drawable.ic_link
        FileKind.FILE, FileKind.OTHER -> R.drawable.ic_draft
    }

@Composable
fun rememberCopier(): (String) -> Unit {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    return remember(clipboard, scope) {
        { text -> scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(text, text))) } }
    }
}

/** A folder entry as a row that opens it; long-press for its path, and for a link to list it as a folder. */
@Composable
fun EntryRow(
    entry: FileEntry,
    path: String,
    index: Int,
    count: Int,
    onOpen: () -> Unit,
    onOpenAsFolder: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val detail = entryDetail(entry)
    GroupedRow(
        index = index,
        count = count,
        onClick = onOpen,
        onLongClick = {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            menu = true
        },
        modifier = modifier,
        leading = { EntryIcon(entry) },
        supporting = detail?.let { { Text(it, style = WorkspaceType.footnote, maxLines = 1) } },
    ) {
        Box {
            Text(entry.name, style = WorkspaceType.body, maxLines = 2, overflow = TextOverflow.MiddleEllipsis)
            EntryMenu(menu, path, isLink = entry.kind == FileKind.SYMLINK, onOpenAsFolder = onOpenAsFolder) { menu = false }
        }
    }
}

@Composable
private fun EntryIcon(entry: FileEntry) {
    if (entry.kind == FileKind.DIR) {
        Icon(FilledFolder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
    } else {
        val image = entry.kind == FileKind.FILE && isImagePath(entry.name)
        Icon(
            painterResource(if (image) R.drawable.ic_photo_library else entry.kind.icon),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EntryMenu(expanded: Boolean, path: String, isLink: Boolean, onOpenAsFolder: () -> Unit, onDismiss: () -> Unit) {
    val copy = rememberCopier()
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if (isLink) {
            MenuItem(R.string.files_open_as_folder, R.drawable.ic_folder) {
                onDismiss()
                onOpenAsFolder()
            }
        }
        MenuItem(R.string.files_copy_path, R.drawable.ic_content_copy) {
            onDismiss()
            copy(path)
        }
    }
}

/** A path in monospace, cut at its start when it does not fit. */
@Composable
fun MonoPath(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall.mono(),
        maxLines = 1,
        overflow = TextOverflow.StartEllipsis,
        modifier = modifier,
    )
}

/** "12 kB · 2 min. ago", what is known of it: a size is a file's, a time is anything's. */
@Composable
private fun entryDetail(entry: FileEntry): String? {
    val context = LocalContext.current
    val size = if (entry.kind == FileKind.FILE) entry.size?.let { Formatter.formatShortFileSize(context, it) } else null
    val parts = listOfNotNull(size, entry.modifiedAt?.let { relativeTime(it) })
    return parts.joinToString(" · ").ifEmpty { null }
}

/** The capsule iOS keeps under the bar for its whole life, so the list beneath it never decides whether it shows. */
@Composable
fun SearchField(query: String, onQuery: (String) -> Unit, prompt: String, modifier: Modifier = Modifier) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .height(36.dp)
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f), CircleShape)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_search), contentDescription = null, tint = secondary, modifier = Modifier.size(20.dp))
        BasicTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            textStyle = WorkspaceType.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { }),
            modifier = Modifier.weight(1f).padding(horizontal = 6.dp).semantics { contentDescription = prompt },
            decorationBox = { field ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) Text(prompt, style = WorkspaceType.body, color = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    field()
                }
            },
        )
        if (query.isNotEmpty()) {
            IconButton(onClick = { onQuery("") }, modifier = Modifier.size(28.dp)) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.files_search_clear), tint = secondary, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/** Open Terminal Here, Show Hidden Files, Copy Path, in iOS's order. */
@Composable
fun FolderMenu(
    showHidden: Boolean,
    reachable: Boolean,
    onShowHidden: (Boolean) -> Unit,
    onCopyPath: () -> Unit,
    onTerminal: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(painterResource(R.drawable.ic_more_horiz), contentDescription = stringResource(R.string.files_more))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            MenuItem(R.string.files_open_terminal, R.drawable.ic_terminal, enabled = reachable) {
                open = false
                onTerminal()
            }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.files_show_hidden)) },
                onClick = { onShowHidden(!showHidden) },
                leadingIcon = { Icon(Eye, contentDescription = null) },
                trailingIcon = { Checkbox(checked = showHidden, onCheckedChange = null) },
            )
            MenuItem(R.string.files_copy_path, R.drawable.ic_content_copy) {
                open = false
                onCopyPath()
            }
        }
    }
}

@Composable
fun MenuItem(text: Int, @DrawableRes icon: Int, enabled: Boolean = true, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(stringResource(text)) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon = { Icon(painterResource(icon), contentDescription = null) },
    )
}
