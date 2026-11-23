package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.feature.chat.work.FoldLead
import com.muzammil.broski.feature.chat.work.WorkEntry
import com.muzammil.broski.feature.chat.work.WorkFold
import com.muzammil.broski.feature.chat.work.workCounts
import uniffi.broski_contract.ImageRef
import uniffi.broski_contract.RunningTool
import uniffi.broski_contract.ToolCallItem
import uniffi.broski_contract.ToolContent
import uniffi.broski_contract.ToolResultItem
import uniffi.broski_core.ToolFacts
import uniffi.broski_core.toolLook

/** A tool call while the transcript is read: its result may come later in the same pass. */
internal class ToolDraft(val call: ToolCallItem, val live: Boolean) {
    var result: ToolResultItem? = null
    var running: RunningTool? = null

    val endAt: Long? get() = result?.at ?: call.at

    fun entry(): WorkEntry.Tool {
        val result = result?.result
        val running = running
        val input = running?.input ?: call.input
        val fileChanges = result?.fileChanges?.takeIf { it.isNotEmpty() } ?: running?.fileChanges.orEmpty()
        val childSession = call.childSession ?: running?.childSession
        val facts = ToolFacts(call.name, call.title ?: running?.title, input, childSession != null, fileChanges.map { it.path })
        return WorkEntry.Tool(
            id = call.toolCallId,
            name = call.name,
            look = toolLook(facts),
            input = input,
            outcome = this.result?.outcome,
            output = result?.content?.filterIsInstance<ToolContent.Text>()?.joinToString("\n") { it.v1.text }
                ?: running?.output.orEmpty(),
            error = result?.error,
            exitCode = result?.exitCode,
            fileChanges = fileChanges,
            display = result?.display,
            images = result?.content?.filterIsInstance<ToolContent.ImageRef>()?.map(ToolContent.ImageRef::v1).orEmpty<ImageRef>(),
            childSession = childSession,
            nested = call.parentToolCallId != null,
        )
    }
}

/** One stretch of work while the transcript is read, turned into its row once the pass is over. */
internal class FoldDraft(val lead: FoldLead, val turnStart: Long?) {
    val parts = mutableListOf<Any>()
    var lastAt: Long? = null

    fun add(entry: WorkEntry, at: Long?) {
        parts += entry
        if (at != null) lastAt = at
    }

    fun add(tool: ToolDraft) {
        parts += tool
        tool.call.at?.let { lastAt = it }
    }

    fun row(): ChatRow.Work {
        val entries = parts.map { if (it is ToolDraft) it.entry() else it as WorkEntry }
        val live = parts.any { (it is ToolDraft && it.live && it.result == null) || (it is WorkEntry.Thought && it.live) }
        val end = parts.mapNotNull { if (it is ToolDraft) it.endAt else null }.maxOrNull() ?: lastAt
        val start = turnStart ?: firstAt()
        val (counts, failed) = workCounts(entries)
        val fold = WorkFold(
            entries = entries,
            lead = lead,
            durationMs = if (live || start == null || end == null) null else (end - start).coerceAtLeast(0),
            counts = counts,
            failed = failed,
            live = live,
            turnStartedAt = turnStart,
            endedAt = end,
        )
        return ChatRow.Work("w:${entries.first().id}", firstAt(), fold)
    }

    private fun firstAt(): Long? = (parts.firstOrNull() as? ToolDraft)?.call?.at ?: lastAt
}
