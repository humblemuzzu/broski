package com.muzammil.broski.design.format

import android.content.ClipData
import android.content.Intent
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.muzammil.broski.R
import kotlinx.coroutines.launch
import uniffi.broski_core.FormatBlock
import uniffi.broski_core.FormatContent
import uniffi.broski_core.FormatLink
import uniffi.broski_core.LinkKind
import uniffi.broski_core.formatPlainText

/**
 * Long-press for the whole text: the block's own links first (each opens on a tap, its copy beside
 * it), then Copy (its markdown), Copy as plain text, Select text (a sheet with all of it selectable
 * at once) and Share. [text] is read when an item is chosen, so a streaming answer copies what it
 * says by then. Code blocks and tables inside keep their own, since they take the press first.
 */
@Composable
fun AnswerMenu(text: () -> String?, modifier: Modifier = Modifier, links: List<FormatLink> = emptyList(), content: @Composable () -> Unit) {
    var open by remember { mutableStateOf(false) }
    var selecting by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val formatLinks = LocalFormatLinks.current
    val scope = rememberCoroutineScope()
    val menuLabel = stringResource(R.string.format_answer_menu)
    fun copy(value: String) {
        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(value.take(40), value))) }
    }
    val press = Modifier
        .pointerInput(Unit) { detectTapGestures(onLongPress = { open = text() != null }) }
        .semantics { onLongClick(menuLabel) { open = text() != null; true } }
    Box(modifier.then(press)) {
        content()
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            links.forEach { link ->
                DropdownMenuItem(
                    text = { Text(link.target, maxLines = 1, overflow = TextOverflow.MiddleEllipsis) },
                    onClick = {
                        open = false
                        openLink(context, formatLinks, link)
                    },
                    trailingIcon = {
                        IconButton(onClick = {
                            open = false
                            copy(copiedLink(link))
                        }) { Icon(painterResource(R.drawable.ic_content_copy), stringResource(R.string.format_copy_link), Modifier.size(18.dp)) }
                    },
                )
            }
            if (links.isNotEmpty()) HorizontalDivider()
            DropdownMenuItem(text = { Text(stringResource(R.string.format_copy)) }, onClick = {
                open = false
                text()?.let(::copy)
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.format_copy_plain)) }, onClick = {
                open = false
                text()?.let { copy(formatPlainText(it)) }
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.format_select_text)) }, onClick = {
                open = false
                selecting = text()?.let(::formatPlainText)
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.format_share)) }, onClick = {
                open = false
                text()?.let { value ->
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value)
                    context.startActivity(Intent.createChooser(send, null))
                }
            })
        }
    }
    selecting?.let { plain -> SelectTextSheet(plain) { selecting = null } }
}

/**
 * The block's links a long-press offers by name, since a press on text cannot be told apart from a
 * press on its link: web pages, addresses and files, each once.
 */
fun FormatBlock.menuLinks(): List<FormatLink> {
    val spans = when (val content = content) {
        is FormatContent.Paragraph -> content.spans
        is FormatContent.Heading -> content.spans
        is FormatContent.Table -> (content.table.header + content.table.rows.flatten()).flatMap { it.spans }
        else -> emptyList()
    }
    return spans.mapNotNull { it.link }
        .filter { it.kind is LinkKind.Web || it.kind is LinkKind.Mail || it.kind is LinkKind.File }
        .distinctBy { it.target }
        .take(FormatTokens.MENU_LINKS)
}

private fun copiedLink(link: FormatLink): String {
    val line = (link.kind as? LinkKind.File)?.line
    return if (line != null) "${link.target}:$line" else link.target
}

/** The whole text in one selectable view, full screen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelectTextSheet(text: String, onDone: () -> Unit) {
    Dialog(onDismissRequest = onDone, properties = FullScreenDialog) {
        Scaffold(
            contentWindowInsets = WindowInsets.safeDrawing,
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.format_select_text)) },
                    actions = { TextButton(onClick = onDone) { Text(stringResource(R.string.format_done)) } },
                )
            },
        ) { padding ->
            Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                SelectionContainer {
                    Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}
