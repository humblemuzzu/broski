package com.muzammil.broski.feature.chat.work

import androidx.compose.runtime.Immutable

/** A verb of the fold's sentence, most consequential first. */
enum class WorkVerb { Edited, Ran, Read, Searched, Fetched, Delegated, Used }

@Immutable
data class WorkCount(val verb: WorkVerb, val count: Int)

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
    val counts: List<WorkCount>,
    val failed: Int,
    val live: Boolean,
) {
    val thoughtOnly: Boolean get() = counts.isEmpty() && entries.all { it is WorkEntry.Thought }
}

/** At most this many verbs, so the sentence stays one line. */
private const val MAX_VERBS = 2

/**
 * The verbs a stretch's rows add up to. Files count once however often they are read or edited;
 * a call that edited is not also counted as read.
 */
fun workCounts(entries: List<WorkEntry>): Pair<List<WorkCount>, Int> {
    val tools = entries.filterIsInstance<WorkEntry.Tool>()
    val edited = tools.filter { it.kind == ToolKind.Edit || it.fileChanges.isNotEmpty() }.flatMap { it.targets() }.toSet()
    val read = tools.filter { it.kind == ToolKind.Read }.flatMap { it.targets() }.toSet() - edited
    val counted = mapOf(
        WorkVerb.Edited to edited.size,
        WorkVerb.Ran to tools.count { it.kind == ToolKind.Command },
        WorkVerb.Read to read.size,
        WorkVerb.Searched to tools.count { it.kind == ToolKind.Search },
        WorkVerb.Fetched to tools.count { it.kind == ToolKind.Fetch },
        WorkVerb.Delegated to tools.count { it.kind == ToolKind.Agent },
    )
    val named = counted.filterValues { it > 0 }.map { (verb, count) -> WorkCount(verb, count) }.take(MAX_VERBS)
    val others = tools.count { it.kind == ToolKind.Other }
    val counts = if (named.size < MAX_VERBS && others > 0) named + WorkCount(WorkVerb.Used, others) else named
    return counts to tools.count { it.failed }
}

/** A call whose input names no path still counts as one file. */
private fun WorkEntry.Tool.targets(): List<String> = paths().ifEmpty { listOf(id) }
