package com.muzammil.broski.feature.chat.transcript

import androidx.compose.runtime.Immutable
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.InteractionRequest
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.TranscriptItem

/** What the one live line under the transcript says while the session is busy. */
@Immutable
sealed interface LaneStatus {
    /** A run that has shown nothing yet: "Agent is working" over "New output will appear here". */
    data object Starting : LaneStatus

    data object Working : LaneStatus

    data object Thinking : LaneStatus

    data object WaitingForApproval : LaneStatus

    data object WaitingForAnswer : LaneStatus

    data object Compacting : LaneStatus

    data class Retrying(val retryAt: Long?) : LaneStatus
}

/** The lane's words for this snapshot, `null` when nothing is under way. Read off the snapshot, never guessed. */
fun laneStatus(snapshot: SessionSnapshot): LaneStatus? {
    snapshot.compaction?.let { return LaneStatus.Compacting }
    snapshot.retry?.let { return LaneStatus.Retrying(it.retryAt) }
    snapshot.interactions.firstOrNull { it.blocksRun }?.let { ask ->
        return if (ask.request is InteractionRequest.ToolPermission) LaneStatus.WaitingForApproval else LaneStatus.WaitingForAnswer
    }
    val run = snapshot.run ?: return null
    val shown = run.items.any { it !is TranscriptItem.UserMessage } || snapshot.blocks.isNotEmpty() || snapshot.tools.isNotEmpty()
    return when {
        !shown -> LaneStatus.Starting
        snapshot.blocks.lastOrNull()?.kind == BlockKind.THINKING -> LaneStatus.Thinking
        else -> LaneStatus.Working
    }
}
