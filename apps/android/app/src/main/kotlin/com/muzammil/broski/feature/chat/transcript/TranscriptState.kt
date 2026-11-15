package com.muzammil.broski.feature.chat.transcript

import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.snapshots.SnapshotStateSet
import androidx.compose.runtime.mutableStateSetOf
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch

/**
 * The transcript's scroll and what is open in it. The list starts at its end (newest first, laid
 * out bottom up) with the status lane as its first item, so while the person is at the end every
 * new row lands above the lane in view with no scroll call at all; when they are not, the list
 * keeps the row they read in place. [follow] only tracks which of the two it is, for the jump button.
 */
@Stable
class TranscriptState(
    val list: LazyListState,
    following: Follow,
    val openFolds: SnapshotStateSet<String>,
    val openEntries: SnapshotStateSet<String>,
) {
    var follow by mutableStateOf(following)

    /** Within a pixel of the end: a collapse clamps exactly to it, a nudge away is the person's. */
    val atEnd: Boolean by derivedStateOf { list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset <= 1 }

    /** Whether there is transcript under the top bar, which then takes its scrim. */
    val scrolledUnderTop: Boolean by derivedStateOf { list.canScrollForward }

    internal var dragged = false

    suspend fun jump(animate: Boolean) {
        follow = follow.jumped()
        if (animate) list.animateScrollToItem(0) else list.scrollToItem(0)
    }

    companion object {
        fun saver(list: LazyListState) = listSaver<TranscriptState, Any>(
            save = { listOf(it.follow.following, it.follow.unseen, it.openFolds.toList(), it.openEntries.toList()) },
            restore = { saved ->
                @Suppress("UNCHECKED_CAST")
                TranscriptState(
                    list,
                    Follow(saved[0] as Boolean, saved[1] as Int),
                    mutableStateSetOf(*(saved[2] as List<String>).toTypedArray()),
                    mutableStateSetOf(*(saved[3] as List<String>).toTypedArray()),
                )
            },
        )
    }
}

@Composable
fun rememberTranscriptState(list: LazyListState): TranscriptState =
    rememberSaveable(list, saver = TranscriptState.saver(list)) {
        TranscriptState(list, Follow(), mutableStateSetOf(), mutableStateSetOf())
    }

/**
 * Feeds [TranscriptState.follow]: the person's drags (and the fling after them) detach or follow
 * by where they leave the list; rows arriving while detached are counted.
 */
@Composable
fun TrackFollow(state: TranscriptState, rows: List<ChatRow>) {
    LaunchedEffect(state) {
        launch {
            state.list.interactionSource.interactions.filterIsInstance<DragInteraction.Start>().collect { state.dragged = true }
        }
        snapshotFlow { state.list.isScrollInProgress to state.atEnd }
            .distinctUntilChanged()
            .filter { state.dragged }
            .collect { (moving, atEnd) ->
                state.follow = state.follow.scrolled(atEnd)
                if (!moving) state.dragged = false
            }
    }
    val previous = remember { arrayOf(rows) }
    LaunchedEffect(rows) {
        state.follow = state.follow.arrived(newMessages(previous[0], rows))
        previous[0] = rows
    }
}
