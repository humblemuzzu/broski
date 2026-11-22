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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.animationsEnabled
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

    /**
     * How far the end is below what shows, in px: the lane is item 0 of the bottom-up list, so the end
     * is as far away as the lane is scrolled off; any later item first means it is out of sight.
     */
    val distanceFromEnd: Int by derivedStateOf {
        if (list.firstVisibleItemIndex == 0) list.firstVisibleItemScrollOffset else Int.MAX_VALUE
    }

    /** Whether there is transcript under the top bar, which then takes its scrim. */
    val scrolledUnderTop: Boolean by derivedStateOf { list.canScrollForward }

    internal var dragged = false
    internal var dragStartDistance = 0

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

/** A drag this far from the end leaves it; a scroll at rest this close to it is at it. */
private val DETACH_DISTANCE = 24.dp
private val FOLLOW_DISTANCE = 48.dp

/**
 * Feeds [TranscriptState.follow]: the person's drags (and the fling after them) detach once they take
 * the end more than [DETACH_DISTANCE] away; where they come to rest follows again within
 * [FOLLOW_DISTANCE], gliding the rest of the way. Rows arriving while detached are counted.
 */
@Composable
fun TrackFollow(state: TranscriptState, rows: List<ChatRow>) {
    val density = LocalDensity.current
    val detachPx = with(density) { DETACH_DISTANCE.roundToPx() }
    val followPx = with(density) { FOLLOW_DISTANCE.roundToPx() }
    val animate = animationsEnabled()
    LaunchedEffect(state, detachPx, followPx, animate) {
        launch {
            state.list.interactionSource.interactions.filterIsInstance<DragInteraction.Start>().collect {
                state.dragged = true
                state.dragStartDistance = state.distanceFromEnd
            }
        }
        snapshotFlow { state.list.isScrollInProgress to state.distanceFromEnd }
            .distinctUntilChanged()
            .filter { state.dragged }
            .collect { (moving, distance) ->
                if (moving) {
                    val travelled = if (distance == Int.MAX_VALUE) {
                        Int.MAX_VALUE
                    } else if (state.dragStartDistance == Int.MAX_VALUE) {
                        0
                    } else {
                        (distance - state.dragStartDistance).coerceAtLeast(0)
                    }
                    state.follow = state.follow.dragged(travelled, distance, detachPx)
                } else {
                    state.dragged = false
                    state.follow = state.follow.settled(distance, followPx)
                    if (state.follow.following && distance > 0) {
                        if (animate) state.list.animateScrollToItem(0) else state.list.scrollToItem(0)
                    }
                }
            }
    }
    val previous = remember { arrayOf(rows) }
    LaunchedEffect(rows) {
        state.follow = state.follow.arrived(newMessages(previous[0], rows))
        previous[0] = rows
    }
}
