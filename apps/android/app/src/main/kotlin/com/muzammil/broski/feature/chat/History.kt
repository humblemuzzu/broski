package com.muzammil.broski.feature.chat

import uniffi.broski_contract.IdStability
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_contract.TranscriptPage

/**
 * The finished runs read so far, oldest first, and where the next older page starts. The transcript
 * never overlaps the live run (contract README §8), so this and the snapshot's run together are the
 * whole conversation.
 */
data class History(
    val items: List<TranscriptItem> = emptyList(),
    val olderCursor: String? = null,
    val loaded: Boolean = false,
) {
    val hasOlder: Boolean get() = olderCursor != null

    /** An older page, read with [olderCursor], goes in front. */
    fun withOlder(page: TranscriptPage): History {
        val known = items.mapTo(HashSet()) { it.id }
        val older = page.items.asReversed().filterNot { it.id in known }
        return copy(items = older + items, olderCursor = page.nextCursor)
    }

    /**
     * The newest page, read first or again once a run ended. With stable ids it replaces what it
     * overlaps and keeps the older pages before it; otherwise, or with no overlap, it starts over
     * from this page, since nothing ties it to what was read before.
     */
    fun withNewest(page: TranscriptPage): History {
        val newest = page.items.asReversed()
        val fresh = History(newest, page.nextCursor, loaded = true)
        if (!loaded || page.idStability != IdStability.STABLE || newest.isEmpty()) return fresh
        val overlap = items.indexOfFirst { it.id == newest.first().id }
        if (overlap < 0) return fresh
        return copy(items = items.subList(0, overlap) + newest)
    }
}

val TranscriptItem.id: String
    get() = when (this) {
        is TranscriptItem.UserMessage -> v1.id
        is TranscriptItem.Block -> v1.id
        is TranscriptItem.ToolCall -> v1.id
        is TranscriptItem.ToolResult -> v1.id
        is TranscriptItem.Notice -> v1.id
        is TranscriptItem.Activity -> v1.id
        is TranscriptItem.Compaction -> v1.id
        is TranscriptItem.ModelChange -> v1.id
        is TranscriptItem.RunBoundary -> v1.id
    }

val TranscriptItem.at: Long?
    get() = when (this) {
        is TranscriptItem.UserMessage -> v1.at
        is TranscriptItem.Block -> v1.at
        is TranscriptItem.ToolCall -> v1.at
        is TranscriptItem.ToolResult -> v1.at
        is TranscriptItem.Notice -> v1.at
        is TranscriptItem.Activity -> v1.at
        is TranscriptItem.Compaction -> v1.at
        is TranscriptItem.ModelChange -> v1.at
        is TranscriptItem.RunBoundary -> v1.at
    }
