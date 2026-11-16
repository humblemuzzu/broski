package com.muzammil.broski.feature.chat

import uniffi.broski_contract.ActiveRun
import uniffi.broski_contract.SessionCapabilities
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.SessionStatus
import uniffi.broski_core.SessionChange
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.ViewEnd

/**
 * The chat's copy of a session view: what the core's updates assign, never a reduction of its own
 * (docs/architecture/mobile-core.md, "The update protocol"). After every update it equals
 * `view.snapshot()`. Notices, activities outside a run, errors, extensions and returned input are
 * moments: shown, not kept.
 */
data class LiveSession(
    val session: SessionRef? = null,
    val capabilities: SessionCapabilities? = null,
    val snapshot: SessionSnapshot = EmptySnapshot,
    val status: SessionStatus? = null,
    val ended: ViewEnd? = null,
    /** False while the view attaches again: the snapshot is the last one known, not the session's now. */
    val live: Boolean = true,
) {
    /** Whether the first `Reset` has arrived. */
    val started: Boolean get() = session != null

    /** Attaching again after the link or the bridge came back; a view that ended says so itself. */
    val reconnecting: Boolean get() = !live && ended == null

    /**
     * The state after an update, the moments it carried, and every run that ended in it: a batch
     * can start and end a run, so the end is seen per record, not by comparing the batch's ends.
     */
    class Applied(val session: LiveSession, val moments: List<SessionChange>, val endedRuns: List<ActiveRun>)

    fun apply(update: SessionUpdate): Applied = when (update) {
        is SessionUpdate.Reset -> Applied(
            copy(session = update.session, capabilities = update.capabilities, snapshot = update.snapshot, status = update.status),
            emptyList(),
            listOfNotNull(snapshot.run.takeIf { update.snapshot.run == null && update.session == session }),
        )
        is SessionUpdate.Changes -> {
            val moments = mutableListOf<SessionChange>()
            val ended = mutableListOf<ActiveRun>()
            val snapshot = update.changes.fold(snapshot) { state, change ->
                if (change is SessionChange.RunChanged && change.run == null) state.run?.let(ended::add)
                state.assign(change) ?: state.also { moments += change }
            }
            Applied(copy(snapshot = snapshot, status = update.status), moments, ended)
        }
        is SessionUpdate.Live -> Applied(copy(live = update.live), emptyList(), emptyList())
        is SessionUpdate.Ended -> Applied(copy(ended = update.reason), emptyList(), emptyList())
    }
}

val EmptySnapshot = SessionSnapshot(
    run = null,
    blocks = emptyList(),
    tools = emptyList(),
    interactions = emptyList(),
    queue = emptyList(),
    backgroundTasks = emptyList(),
    modelId = null,
    thinking = null,
    modes = emptyList(),
    usage = null,
    compaction = null,
    retry = null,
    lastOutcome = null,
)

/** The state after `change`, or `null` for a moment, which the state holds none of. */
private fun SessionSnapshot.assign(change: SessionChange): SessionSnapshot? = when (change) {
    is SessionChange.RunChanged -> copy(run = change.run)
    is SessionChange.RunItemAppended -> withRun { copy(items = items + change.item) }
    is SessionChange.RunItemReplaced -> withRun {
        copy(items = items.toMutableList().also { it[change.index.toInt()] = change.item })
    }
    is SessionChange.RunItemsDropped -> withRun {
        copy(items = items.drop(change.count.toInt()), droppedItems = change.droppedItems)
    }
    is SessionChange.BlockOpened -> copy(blocks = blocks + change.block)
    is SessionChange.BlockTextChanged -> copy(
        blocks = blocks.map { if (it.blockId == change.blockId) it.copy(text = change.text) else it },
    )
    is SessionChange.BlockClosed -> copy(blocks = blocks.filterNot { it.blockId == change.blockId })
    is SessionChange.ToolOpened -> copy(tools = tools + change.tool)
    is SessionChange.ToolChanged -> copy(
        tools = tools.map { if (it.toolCallId == change.tool.toolCallId) change.tool else it },
    )
    is SessionChange.ToolClosed -> copy(tools = tools.filterNot { it.toolCallId == change.toolCallId })
    is SessionChange.InteractionAdded -> copy(interactions = interactions + change.interaction)
    is SessionChange.InteractionRemoved -> copy(interactions = interactions.filterNot { it.id == change.interactionId })
    is SessionChange.QueueChanged -> copy(queue = change.items)
    is SessionChange.BackgroundTasksChanged -> copy(backgroundTasks = change.tasks)
    is SessionChange.ModelChanged -> copy(modelId = change.modelId, thinking = change.thinking)
    is SessionChange.ModesChanged -> copy(modes = change.modes)
    is SessionChange.UsageChanged -> copy(usage = change.usage)
    is SessionChange.CompactionChanged -> copy(compaction = change.compaction)
    is SessionChange.RetryChanged -> copy(retry = change.retry)
    is SessionChange.OutcomeChanged -> copy(lastOutcome = change.outcome)
    is SessionChange.NoticeShown, is SessionChange.ActivityShown, is SessionChange.ErrorShown,
    is SessionChange.ExtensionReceived, is SessionChange.InputReturned -> null
}

private inline fun SessionSnapshot.withRun(change: ActiveRun.() -> ActiveRun): SessionSnapshot =
    copy(run = checkNotNull(run) { "the core changes a run's items only while there is a run" }.change())
