package com.muzammil.broski.feature.chat.transcript

import androidx.compose.runtime.Immutable
import com.muzammil.broski.design.orb.OrbState
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.InteractionRequest
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.TranscriptItem

/** What the one live line under the transcript says while the session is busy. */
@Immutable
sealed interface LaneStatus {
    /** A run that has shown nothing yet. */
    data object Starting : LaneStatus

    data object Working : LaneStatus

    data object Thinking : LaneStatus

    data object WaitingForApproval : LaneStatus

    data object WaitingForAnswer : LaneStatus

    data object Compacting : LaneStatus

    data class Retrying(val retryAt: Long?) : LaneStatus
}

/** The orb that leads the lane's words; none while the session waits on the person. */
val LaneStatus.orb: OrbState?
    get() = when (this) {
        LaneStatus.Starting, LaneStatus.Thinking -> OrbState.BREATHING
        LaneStatus.Working -> OrbState.WORKING
        LaneStatus.Compacting -> OrbState.WEAVING
        is LaneStatus.Retrying -> OrbState.CONNECTING
        LaneStatus.WaitingForApproval, LaneStatus.WaitingForAnswer -> null
    }

/**
 * The lane's words for this snapshot, `null` when nothing is under way. Read off the snapshot, never
 * guessed. An ask that blocks the run comes first, as on iOS: an approval is what the person must not miss.
 */
fun laneStatus(snapshot: SessionSnapshot): LaneStatus? {
    snapshot.interactions.firstOrNull { it.blocksRun }?.let { ask ->
        return if (ask.request is InteractionRequest.ToolPermission) LaneStatus.WaitingForApproval else LaneStatus.WaitingForAnswer
    }
    snapshot.compaction?.let { return LaneStatus.Compacting }
    snapshot.retry?.let { return LaneStatus.Retrying(it.retryAt) }
    val run = snapshot.run ?: return null
    val shown = run.items.any { it !is TranscriptItem.UserMessage } || snapshot.blocks.isNotEmpty() || snapshot.tools.isNotEmpty()
    return when {
        !shown -> LaneStatus.Starting
        snapshot.blocks.lastOrNull()?.kind == BlockKind.THINKING -> LaneStatus.Thinking
        else -> LaneStatus.Working
    }
}
