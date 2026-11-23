package com.muzammil.broski.feature.chat.transcript

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.format.AnswerMenu
import com.muzammil.broski.design.format.menuLinks
import com.muzammil.broski.design.format.FormatBlockView
import com.muzammil.broski.design.format.LocalFormatBleed
import com.muzammil.broski.feature.chat.activity.ActivityRow
import com.muzammil.broski.feature.chat.work.WorkActions
import com.muzammil.broski.feature.chat.work.WorkFoldRow
import com.muzammil.broski.feature.images.ChatImageStore
import com.muzammil.broski.feature.images.ImageTarget
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

/** What the transcript's rows reach out to: images, older pages, diffs and subagents. */
@Stable
class TranscriptCallbacks(
    val openImages: (List<ImageTarget>, Int) -> Unit,
    val loadOlder: () -> Unit,
    val work: WorkActions,
)

/** Rows from the end this close to the top start reading the page before them. */
private const val OLDER_AHEAD = 4

/** The transcript's side margin, which a top-level code block or table reaches across. */
val SIDE_MARGIN = 16.dp

/**
 * The conversation, full bleed under the top bar and the composer, laid out from the bottom so a
 * short one sits right above the composer and a long one opens at its end. A tap that does not
 * scroll puts the keyboard away.
 */
@Composable
fun TranscriptList(
    rows: List<ChatRow>,
    lane: LaneStatus?,
    runStartedAt: Long?,
    imageStore: ChatImageStore,
    state: TranscriptState,
    callbacks: TranscriptCallbacks,
    contentPadding: PaddingValues,
    modifier: Modifier = Modifier,
) {
    val focus = LocalFocusManager.current
    val latestRows = rememberUpdatedState(rows)
    TrackFollow(state, rows)
    LoadOlder(state, rows, callbacks.loadOlder)
    LazyColumn(
        state = state.list,
        reverseLayout = true,
        contentPadding = contentPadding,
        modifier = modifier.fillMaxSize().pointerInput(focus) { detectTapGestures(onTap = { focus.clearFocus() }) },
    ) {
        item(key = "lane", contentType = "lane") {
            StatusLaneView(lane, runStartedAt, Modifier.padding(start = SIDE_MARGIN, end = SIDE_MARGIN, top = 8.dp))
        }
        itemsIndexed(rows, key = { _, row -> row.key }, contentType = { _, row -> row::class }) { index, row ->
            val answer = remember(row.key) { { answerOf(latestRows.value, row.key) } }
            Row(row, gap(rows.getOrNull(index + 1), row), imageStore, state, callbacks, answer)
        }
    }
}

/**
 * The rhythm of the page, as iOS spaces it: messages apart, an answer's blocks spaced by the formatter
 * itself, the work and activity of a turn close together. [older] is the row above [row] on the page.
 */
private fun gap(older: ChatRow?, row: ChatRow): Dp = when {
    older == null || older is ChatRow.Older -> 0.dp
    row is ChatRow.User -> 28.dp
    row is ChatRow.Text && older is ChatRow.Text && !row.first -> 0.dp
    row is ChatRow.CopyAnswer -> 6.dp
    row.isWork && older.isWork -> 2.dp
    older is ChatRow.User -> 18.dp
    older is ChatRow.Work && row is ChatRow.Text -> 10.dp
    else -> 14.dp
}

private val ChatRow.isWork: Boolean get() = this is ChatRow.Work || this is ChatRow.Activity

@Composable
private fun Row(row: ChatRow, gap: Dp, imageStore: ChatImageStore, state: TranscriptState, callbacks: TranscriptCallbacks, answer: () -> String?) {
    val padded = Modifier.padding(top = gap).padding(horizontal = SIDE_MARGIN).entrance(row.at)
    when (row) {
        is ChatRow.User -> UserBubble(row, imageStore, callbacks.openImages, padded)
        is ChatRow.Text -> AnswerMenu(answer, padded, links = remember(row.block) { row.block.menuLinks() }) {
            CompositionLocalProvider(LocalFormatBleed provides SIDE_MARGIN) {
                FormatBlockView(row.block, next = row.next, streaming = row.streaming)
            }
        }
        is ChatRow.CopyAnswer -> Column(Modifier.padding(top = gap)) {
            if (row.sources.isNotEmpty()) SourcesList(row.sources, Modifier.padding(start = SIDE_MARGIN, end = SIDE_MARGIN, bottom = 8.dp))
            CopyAnswerRow(row.text, row.at, Modifier.padding(horizontal = SIDE_MARGIN))
        }
        is ChatRow.Work -> WorkFoldRow(
            fold = row.fold,
            expanded = row.key in state.openFolds,
            onToggle = { state.openFolds.toggle(row.key) },
            entryExpanded = { it in state.openEntries },
            onToggleEntry = { state.openEntries.toggle(it) },
            actions = callbacks.work,
            modifier = padded,
        )
        is ChatRow.Note -> NoteRow(row.note, padded)
        is ChatRow.Activity -> ActivityRow(
            activity = row.activity,
            look = row.look,
            expanded = row.key in state.openEntries,
            onToggle = { state.openEntries.toggle(row.key) },
            actions = callbacks.work,
            modifier = padded,
        )
        is ChatRow.Older -> OlderRow()
    }
}

/** The whole answer a block belongs to: the text of the copy row under it (newer rows come first). */
private fun answerOf(rows: List<ChatRow>, key: String): String? {
    val index = rows.indexOfFirst { it.key == key }
    if (index < 0) return null
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
