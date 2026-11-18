package com.muzammil.broski.feature.chat.transcript

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.format.AnswerMenu
import com.muzammil.broski.design.format.menuLinks
import com.muzammil.broski.design.format.FormatBlockView
import com.muzammil.broski.design.format.LocalFormatBleed
import com.muzammil.broski.feature.chat.activity.ActivityRow
import com.muzammil.broski.feature.chat.work.WorkActions
import com.muzammil.broski.feature.chat.work.WorkFoldRow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

/** What the transcript's rows reach out to: images by reference, older pages, diffs and subagents. */
@Stable
class TranscriptCallbacks(
    val requestImage: (String) -> Unit,
    val loadOlder: () -> Unit,
    val work: WorkActions,
)

/** Rows from the end this close to the top start reading the page before them. */
private const val OLDER_AHEAD = 4

/** The transcript's side margin, which a top-level code block or table reaches across. */
val SIDE_MARGIN = 20.dp

/**
 * The conversation, full bleed under the top bar and the composer, laid out from the bottom so a
 * short one sits right above the composer and a long one opens at its end. A tap that does not
 * scroll puts the keyboard away.
 */
@Composable
fun TranscriptList(
    rows: List<ChatRow>,
    lane: LaneStatus?,
    images: Map<String, ImageBitmap>,
    state: TranscriptState,
    callbacks: TranscriptCallbacks,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val focus = LocalFocusManager.current
    TrackFollow(state, rows)
    LoadOlder(state, rows, callbacks.loadOlder)
    LazyColumn(
        state = state.list,
        reverseLayout = true,
        contentPadding = contentPadding,
        modifier = modifier.fillMaxSize().pointerInput(focus) { detectTapGestures(onTap = { focus.clearFocus() }) },
    ) {
        item(key = "lane", contentType = "lane") { StatusLaneView(lane, Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
        items(rows, key = { it.key }, contentType = { it::class }) { row ->
            Row(row, images, state, callbacks) { answerOf(rows, row) }
        }
    }
}

@Composable
private fun Row(row: ChatRow, images: Map<String, ImageBitmap>, state: TranscriptState, callbacks: TranscriptCallbacks, answer: () -> String?) {
    val padded = Modifier.padding(horizontal = SIDE_MARGIN).entrance(row.at)
    when (row) {
        is ChatRow.User -> UserBubble(row, images, callbacks.requestImage, padded.padding(top = 20.dp, bottom = 4.dp))
        is ChatRow.Text -> AnswerMenu(answer, padded.padding(top = if (row.first) 12.dp else 0.dp), links = remember(row.block) { row.block.menuLinks() }) {
            CompositionLocalProvider(LocalFormatBleed provides SIDE_MARGIN) {
                FormatBlockView(row.block, next = row.next, streaming = row.streaming)
            }
        }
        is ChatRow.CopyAnswer -> Column {
            if (row.sources.isNotEmpty()) SourcesList(row.sources, Modifier.padding(start = SIDE_MARGIN, end = SIDE_MARGIN, top = 12.dp))
            CopyAnswerRow(row.text, Modifier.padding(horizontal = 8.dp))
        }
        is ChatRow.Work -> WorkFoldRow(
            fold = row.fold,
            expanded = row.key in state.openFolds,
            onToggle = { state.openFolds.toggle(row.key) },
            entryExpanded = { it in state.openEntries },
            onToggleEntry = { state.openEntries.toggle(it) },
            actions = callbacks.work,
            modifier = padded.padding(top = 8.dp),
        )
        is ChatRow.Note -> NoteRow(row.note, padded.padding(vertical = 12.dp))
        is ChatRow.Activity -> ActivityRow(
            activity = row.activity,
            look = row.look,
            expanded = row.key in state.openEntries,
            onToggle = { state.openEntries.toggle(row.key) },
            actions = callbacks.work,
            modifier = padded.padding(top = 6.dp),
        )
        is ChatRow.Older -> OlderRow()
    }
}

/** The whole answer a block belongs to: the text of the copy row under it (newer rows come first). */
private fun answerOf(rows: List<ChatRow>, row: ChatRow): String? {
    val index = rows.indexOf(row)
    for (newer in index downTo 0) {
        when (val candidate = rows[newer]) {
            is ChatRow.CopyAnswer -> return candidate.text
            is ChatRow.User -> return null
            else -> Unit
        }
    }
    return null
}

private fun MutableSet<String>.toggle(key: String) {
    if (!remove(key)) add(key)
}

@Composable
private fun LoadOlder(state: TranscriptState, rows: List<ChatRow>, loadOlder: () -> Unit) {
    val hasOlder = rows.lastOrNull() is ChatRow.Older
    LaunchedEffect(state, hasOlder) {
        if (!hasOlder) return@LaunchedEffect
        snapshotFlow {
            val info = state.list.layoutInfo
            (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - OLDER_AHEAD
        }.distinctUntilChanged().filter { it }.collect { loadOlder() }
    }
}
