package com.muzammil.broski.feature.chat.work

import androidx.compose.runtime.Immutable
import uniffi.broski_core.FoldCount
import uniffi.broski_core.FoldTool
import uniffi.broski_core.foldCounts

/**
 * How the fold opens its sentence: `Worked for 2m` for a turn's first stretch of work,
 * `Continued for 40s` after the person steered it, nothing for a later stretch of the same turn.
 */
enum class FoldLead { Worked, Continued, None }

/**
 * One stretch of work between the agent's words: its rows and the one-line sentence that stands for
 * them, `Worked for 2m · Edited 1 file · Ran 2 commands · 1 failed`.
 */
@Immutable
data class WorkFold(
    val entries: List<WorkEntry>,
    val lead: FoldLead,
    /** From the turn's start to the stretch's last row; `null` while it is live or when a time is missing. */
    val durationMs: Long?,
    val counts: List<FoldCount>,
    val failed: Int,
    val live: Boolean,
) {
    val thoughtOnly: Boolean get() = counts.isEmpty() && entries.all { it is WorkEntry.Thought }
}

/** The core's verbs for the stretch's own calls, not a subagent's, and how many of those failed. */
fun workCounts(entries: List<WorkEntry>): Pair<List<FoldCount>, Int> {
    val own = entries.filterIsInstance<WorkEntry.Tool>().filterNot { it.nested }
    return foldCounts(own.map { FoldTool(it.id, it.kind, it.look.paths) }) to own.count { it.failed }
}
