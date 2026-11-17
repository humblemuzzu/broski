package com.muzammil.broski.feature.chat.work

import android.content.ClipData
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.format.FormatBlockView
import com.muzammil.broski.design.format.FormatCache
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import kotlinx.coroutines.launch
import uniffi.broski_contract.ActivityFormat

/** A long text a row only shows a clip of (a log, a tool's output, a report), to open whole. */
@Immutable
data class TextPage(val title: String, val text: String, val format: Format) {
    enum class Format {
        MARKDOWN,
        PLAIN,

        /** Monospaced output whose newest lines matter: it opens at its end. */
        LOG,
    }

    companion object {
        fun formatOf(format: ActivityFormat): Format = when (format) {
            ActivityFormat.MARKDOWN -> Format.MARKDOWN
            ActivityFormat.TEXT -> Format.PLAIN
            ActivityFormat.LOG -> Format.LOG
        }
    }
}

/** The whole text over the chat, the whole height, drawn line by line as it scrolls; copy in its header. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TextSheet(page: TextPage, onDismiss: () -> Unit) {
    val lines = remember(page) { if (page.format == TextPage.Format.MARKDOWN) emptyList() else page.text.split('\n') }
    val blocks = remember(page) { if (page.format == TextPage.Format.MARKDOWN) FormatCache.blocks(page.text, false) else emptyList() }
    val list = rememberLazyListState(initialFirstVisibleItemIndex = if (page.format == TextPage.Format.LOG) lines.lastIndex.coerceAtLeast(0) else 0)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SheetHeader(page)
        LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
            if (page.format == TextPage.Format.MARKDOWN) {
                items(blocks, key = { it.key }) { block -> FormatBlockView(block, Modifier.padding(top = 12.dp)) }
            } else {
                items(lines.size) { index ->
                    SelectionContainer {
                        Text(
                            lines[index],
                            style = if (page.format == TextPage.Format.LOG) MaterialTheme.typography.bodySmall.mono() else MaterialTheme.typography.bodyMedium,
                            color = if (page.format == TextPage.Format.LOG) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SheetHeader(page: TextPage) {
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(page.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        IconButton(onClick = {
            scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(page.title, page.text))) }
            haptics.perform(Haptic.Success)
        }) {
            Icon(painterResource(R.drawable.ic_content_copy), contentDescription = stringResource(R.string.chat_copy_text))
        }
    }
}
