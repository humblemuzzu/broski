package com.muzammil.broski.feature.chat.transcript

import androidx.compose.runtime.staticCompositionLocalOf
import com.muzammil.broski.feature.chat.work.FoldLead
import com.muzammil.broski.feature.chat.work.WorkFold
import com.muzammil.broski.feature.chat.work.workCounts

/** Whether a turn's work folds into one line above its answer (Settings › Appearance); on unless the person turns it off. */
val LocalCollapsesWork = staticCompositionLocalOf { true }

/**
 * A turn's work as one line above its answer, as iOS folds it. Between two breaks (the person's
 * message, a note, an activity) the agent works in stretches and writes between them, ending on its
 * answer: the words after its last call. Everything up to that last call, the stretches and the words
 * between them, is what the turn did to get there, and folds under one [ChatRow.WorkGroup]
 * (`Worked for 40m · Edited 3 files · Ran 12 commands`) when there is more than one row's worth to
 * hide. A turn that ends on a call has no answer yet (or none at all): all of it folds. A single
 * stretch followed by the answer is already one line, its own fold.
 */
object WorkGroups {
    /** What [shown] returns: the rows to draw, and the keys of those a group the person opened holds. */
    class Shown(val rows: List<ChatRow>, val revealed: Set<String>)

    /** [rows], oldest first, with a group row put above each stretch that folds. */
    fun grouping(rows: List<ChatRow>): List<ChatRow> {
        val grouped = ArrayList<ChatRow>(rows.size + 2)
        var start = 0
        while (start < rows.size) {
            val end = (start until rows.size).firstOrNull { rows[it].isBreak } ?: rows.size
            grouped += group(rows.subList(start, end))
            if (end < rows.size) grouped += rows[end]
            start = end + 1
        }
        return grouped
    }

    private fun group(stretch: List<ChatRow>): List<ChatRow> {
        val last = stretch.indexOfLast { it is ChatRow.Work }
        if (last < 0) return stretch
        val members = stretch.subList(0, last + 1)
        if (members.size < 2) return stretch
        val folds = members.filterIsInstance<ChatRow.Work>().map { it.fold }
        val entries = folds.flatMap { it.entries }
        val (counts, failed) = workCounts(entries)
        val live = folds.last().live
        val start = folds.first().turnStartedAt
        val end = folds.mapNotNull { it.endedAt }.maxOrNull()
        val summary = WorkFold(
            entries = entries,
            lead = FoldLead.Worked,
            durationMs = if (live || start == null || end == null) null else (end - start).coerceAtLeast(0),
            counts = counts,
            failed = failed,
            live = live,
        )
        return listOf(ChatRow.WorkGroup("g:${members.first().key}", members.first().at, summary, members.size)) + stretch
    }

    /**
     * What the transcript draws of [rows] (newest first): with folding on, each group's row and,
     * once the person has opened it, the rows it holds; with it off, the rows alone, as they were
     * before groups.
     */
    fun shown(rows: List<ChatRow>, collapsing: Boolean, isOpen: (String) -> Boolean): Shown {
        if (rows.none { it is ChatRow.WorkGroup }) return Shown(rows, emptySet())
        val oldestFirst = rows.asReversed()
        val drawn = ArrayList<ChatRow>(rows.size)
        val revealed = HashSet<String>()
        var index = 0
        while (index < oldestFirst.size) {
            val row = oldestFirst[index++]
            if (row !is ChatRow.WorkGroup) {
                drawn += row
                continue
            }
            val members = oldestFirst.subList(index, minOf(oldestFirst.size, index + row.members))
            index += members.size
            if (!collapsing) {
                drawn += members
                continue
            }
            drawn += row
            if (isOpen(row.key)) {
                drawn += members
                members.mapTo(revealed) { it.key }
            }
        }
        return Shown(drawn.asReversed(), revealed)
    }

    private val ChatRow.isBreak: Boolean get() = this is ChatRow.User || this is ChatRow.Note || this is ChatRow.Activity || this is ChatRow.Older
}
