package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.design.format.FormatCache
import com.muzammil.broski.feature.chat.work.FoldLead
import com.muzammil.broski.feature.chat.work.WorkEntry
import uniffi.broski_contract.AttachmentRef
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.LinkItem
import uniffi.broski_contract.OpenBlock
import uniffi.broski_contract.RunOutcome
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.ToolDisplay
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_contract.UserMessageItem
import uniffi.broski_core.FormatBlock
import uniffi.broski_core.activityLook

/** A message the person sent that the agent has not yet shown as its own. */
data class PendingSend(val clientRequestId: String, val text: String, val at: Long)

/** Everything the transcript shows: finished runs oldest first, then the live state. */
class RowInput(
    val history: List<TranscriptItem>,
    val snapshot: SessionSnapshot,
    val pending: List<PendingSend>,
    val hasOlder: Boolean,
    val now: Long,
)

/**
 * Lays the conversation out as rows, newest first for a list that starts at its end. Turns run from
 * one message of the person's to the next; the agent's words are the page, block by block, and the
 * work between them folds into one row a stretch. It derives nothing about the session: what is
 * running or pending is the snapshot's.
 *
 * [format] gives a text's formatted blocks, by its text and whether it is still streaming; the
 * cache behind it formats a finished text once, so a streaming message costs one parse a batch.
 */
class RowBuilder(private val format: (String, Boolean) -> List<FormatBlock> = FormatCache::blocks) {
    fun build(input: RowInput): List<ChatRow> {
        val pass = Pass(input)
        input.history.forEach { pass.item(it, live = false) }
        input.snapshot.run?.items?.forEachIndexed { index, item -> pass.item(item, live = true, continued = index > 0) }
        input.snapshot.blocks.forEach(pass::openBlock)
        pass.pending()
        return pass.finish()
    }

    private inner class Pass(private val input: RowInput) {
        private val rows = mutableListOf<Any>()
        private val tools = HashMap<String, ToolDraft>()
        private val shownRequests = HashSet<String>()
        private var fold: FoldDraft? = null
        private var turn = Turn(start = null, continued = false, live = false)

        fun item(item: TranscriptItem, live: Boolean, continued: Boolean = false) {
            when (item) {
                is TranscriptItem.UserMessage -> user(item.v1, live, continued)
                is TranscriptItem.Block -> block(item.v1.id, item.v1.at, item.v1.block, item.v1.text, item.v1.parentToolCallId, live)
                is TranscriptItem.ToolCall -> work(live).add(
                    ToolDraft(item.v1, live).also { draft ->
                        draft.running = input.snapshot.tools.firstOrNull { it.toolCallId == item.v1.toolCallId }
                        tools[item.v1.toolCallId] = draft
                    },
                )
                is TranscriptItem.ToolResult -> {
                    tools[item.v1.toolCallId]?.result = item.v1
                    (item.v1.result.display as? ToolDisplay.Links)?.v1?.items?.forEach { found ->
                        if (turn.sources.none { it.url == found.url }) turn.sources += found
                    }
                }
                is TranscriptItem.Notice -> note(item.v1.id, item.v1.at, TranscriptNote.Notice(item.v1.level, item.v1.text))
                is TranscriptItem.Activity -> {
                    fold = null
                    rows += ChatRow.Activity("a:${item.v1.id}", item.v1.at, item.v1.activity, activityLook(item.v1.activity))
                    turn.start = item.v1.at
                }
                is TranscriptItem.Compaction -> {
                    note(item.v1.id, item.v1.at, TranscriptNote.Compacted(item.v1.tokensBefore, item.v1.tokensAfter))
                    turn.start = item.v1.at
                }
                is TranscriptItem.ModelChange -> note(item.v1.id, item.v1.at, TranscriptNote.ModelChanged(item.v1.modelId, item.v1.thinking))
                is TranscriptItem.RunBoundary -> {
                    item.v1.outcome.stopped()?.let { note(item.v1.id, item.v1.at, it) }
                    turn.start = item.v1.at
                }
            }
        }

        fun openBlock(block: OpenBlock) = block(block.blockId, input.now, block.kind, block.text, block.parentToolCallId, live = true, open = true)

        fun pending() = input.pending.filterNot { it.clientRequestId in shownRequests }.forEach { send ->
            closeTurn()
            rows += ChatRow.User("c:${send.clientRequestId}", send.at, send.text, emptyList(), pending = true)
            turn = Turn(start = send.at, continued = turn.live, live = true)
        }

        private fun user(message: UserMessageItem, live: Boolean, continued: Boolean) {
            closeTurn()
            message.clientRequestId?.let(shownRequests::add)
            val images = message.attachments.filterIsInstance<AttachmentRef.ImageRef>().map { it.v1 }
            val key = message.clientRequestId?.let { "c:$it" } ?: "u:${message.id}"
            rows += ChatRow.User(key, message.at, message.text, images, pending = false)
            turn = Turn(start = message.at, continued = live && continued, live = live)
        }

        private fun block(id: String, at: Long?, kind: BlockKind, text: String, parent: String?, live: Boolean, open: Boolean = false) {
            if (live) turn.live = true
            when {
                parent != null -> work(live).add(WorkEntry.Aside(id, text), at)
                kind == BlockKind.THINKING -> work(live).add(WorkEntry.Thought(id, text, live = open), at)
                text.isBlank() -> Unit
                else -> {
                    fold = null
                    val blocks = format(text, open)
                    blocks.forEachIndexed { index, block ->
                        val next = blocks.getOrNull(index + 1)?.containers?.map { it.id }.orEmpty()
                        rows += ChatRow.Text(
                            "t:$id/${block.key}", at, block, first = index == 0, plan = kind == BlockKind.PLAN,
                            next = next, streaming = open && index == blocks.lastIndex,
                        )
                    }
                    turn.answer += text
                    turn.lastTextId = id
                    turn.copyAt = rows.size
                }
            }
        }

        private fun work(live: Boolean): FoldDraft = fold ?: FoldDraft(turn.nextLead(), turn.start).also {
            fold = it
            rows += it
            turn.live = turn.live || live
        }

        private fun note(id: String, at: Long?, note: TranscriptNote) {
            fold = null
            rows += ChatRow.Note("n:$id", at, note)
        }

        private fun closeTurn() {
            fold = null
            val last = turn.lastTextId ?: return
            if (!turn.live) rows.add(turn.copyAt, ChatRow.CopyAnswer("copy:$last", null, turn.answer.joinToString("\n\n"), turn.sources.toList()))
        }

        fun finish(): List<ChatRow> {
            if (input.snapshot.run == null) closeTurn()
            val built = rows.map { if (it is FoldDraft) it.row() else it as ChatRow }
            val unique = LinkedHashMap<String, ChatRow>()
            built.forEach { unique.putIfAbsent(it.key, it) }
            val newestFirst = unique.values.reversed()
            return if (input.hasOlder) newestFirst + ChatRow.Older() else newestFirst
        }
    }

    private class Turn(var start: Long?, val continued: Boolean, var live: Boolean) {
        val answer = mutableListOf<String>()

        /** The pages the turn's searches found, which the answer drew on. */
        val sources = mutableListOf<LinkItem>()
        var lastTextId: String? = null

        /** Right under the answer's last block, above any note that came after it. */
        var copyAt = 0
        private var folds = 0

        fun nextLead(): FoldLead = when {
            folds++ > 0 -> FoldLead.None
            continued -> FoldLead.Continued
            else -> FoldLead.Worked
        }
    }
}

private fun RunOutcome.stopped(): TranscriptNote.Stopped? = when (this) {
    is RunOutcome.Completed -> null
    is RunOutcome.Aborted -> TranscriptNote.Stopped(failure = null, limit = null)
    is RunOutcome.Error -> TranscriptNote.Stopped(failure = v1.error.message, limit = null)
    is RunOutcome.Limit -> TranscriptNote.Stopped(failure = null, limit = v1.limit)
    is RunOutcome.Deferred -> null
}
