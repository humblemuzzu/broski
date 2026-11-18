package com.muzammil.broski.feature.workspace.files

import android.text.format.Formatter
import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.relativeTime
import uniffi.broski_contract.FileEntry
import uniffi.broski_contract.FileKind

@get:DrawableRes
val FileKind.icon: Int
    get() = when (this) {
        FileKind.DIR -> R.drawable.ic_folder
        FileKind.SYMLINK -> R.drawable.ic_link
        FileKind.FILE, FileKind.OTHER -> R.drawable.ic_draft
    }

@Composable
fun EntryRow(entry: FileEntry, index: Int, count: Int, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    GroupedRow(
        index = index,
        count = count,
        onClick = onOpen,
        modifier = modifier,
        leading = {
            Icon(
                painterResource(entry.kind.icon),
                contentDescription = null,
                tint = if (entry.kind == FileKind.DIR) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        supporting = if (entry.kind == FileKind.DIR) null else ({ Text(entryDetails(entry), maxLines = 1) }),
        trailing = if (entry.kind == FileKind.DIR) ({ Icon(painterResource(R.drawable.ic_chevron_right), null) }) else null,
    ) {
        Text(entry.name, maxLines = 2, overflow = TextOverflow.MiddleEllipsis)
    }
}

/** "12 kB · 2 min. ago", what is known of it. */
@Composable
private fun entryDetails(entry: FileEntry): String {
    val context = LocalContext.current
    return listOfNotNull(
        entry.size?.let { Formatter.formatShortFileSize(context, it) },
        entry.modifiedAt?.let { relativeTime(it) },
    ).joinToString(" · ")
}

@Composable
fun MonoPath(path: String, modifier: Modifier = Modifier) {
    Text(
        path,
        style = MaterialTheme.typography.bodySmall.mono(),
        maxLines = 1,
        overflow = TextOverflow.StartEllipsis,
        modifier = modifier,
    )
}

@Composable
fun SearchField(query: String, onQuery: (String) -> Unit, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).focusRequester(focus),
        placeholder = { Text(stringResource(R.string.files_search_placeholder)) },
        leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null) },
        trailingIcon = {
            IconButton(onClick = onClose) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.files_search_close))
            }
        },
        singleLine = true,
        shape = CircleShape,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    )
}

/** Hidden files, copy path, and a terminal in the folder. */
@Composable
fun FolderMenu(
    showHidden: Boolean,
    onShowHidden: (Boolean) -> Unit,
    onCopyPath: () -> Unit,
    onTerminal: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.files_more))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.files_show_hidden)) },
                onClick = { onShowHidden(!showHidden) },
                trailingIcon = { Checkbox(checked = showHidden, onCheckedChange = null) },
            )
            MenuAction(R.string.files_copy_path, R.drawable.ic_content_copy) { open = false; onCopyPath() }
            MenuAction(R.string.files_open_terminal, R.drawable.ic_terminal) { open = false; onTerminal() }
        }
    }
}

@Composable
private fun MenuAction(text: Int, @DrawableRes icon: Int, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(stringResource(text)) },
        onClick = onClick,
        leadingIcon = { Icon(painterResource(icon), contentDescription = null) },
    )
}
