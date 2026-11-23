package com.muzammil.broski.feature.inbox

import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.InboxFilter
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.SessionKey
import com.muzammil.broski.core.agent
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.needsMention
import com.muzammil.broski.core.sessionKey
import com.muzammil.broski.design.settling
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

/** The inbox's sections, in the order they are listed. */
enum class InboxGroup { NEEDS_YOU, PINNED, WORKING, DONE, IDLE }

@Immutable
data class InboxSection(val group: InboxGroup, val rows: List<InboxRow>)

/** A machine the inbox has to say something about, with its sessions' status. */
@Immutable
data class MachineMention(val id: String, val name: String, val health: MachineHealth)

/** The sessions the person pinned and muted on this phone. */
@Immutable
data class SessionMarks(val pinned: Set<SessionKey> = emptySet(), val muted: Set<SessionKey> = emptySet())

@Immutable
data class InboxUiState(
    val sections: List<InboxSection> = emptyList(),
    val health: Map<String, MachineHealth> = emptyMap(),
    val machines: List<MachineState> = emptyList(),
    val mentions: List<MachineMention> = emptyList(),
    /** Every row, before the filter and the search: the filter menu's agents and folders come from them. */
    val rows: List<InboxRow> = emptyList(),
    val filter: InboxFilter = InboxFilter(),
    val query: String = "",
    val refreshing: Boolean = false,
    val anyOnline: Boolean = false,
    val connecting: Boolean = false,
    /** Rows whose answer is on its way ([key]); their actions wait for it. */
    val answering: Set<String> = emptySet(),
    val marks: SessionMarks = SessionMarks(),
    /** Older sessions are still to load as the person scrolls down. */
    val hasMore: Boolean = false,
) {
    val isEmpty: Boolean get() = sections.isEmpty()

    /** Idle is all there is, so its rows show without the person opening it. */
    val onlyIdle: Boolean get() = sections.isNotEmpty() && sections.all { it.group == InboxGroup.IDLE }

    fun agent(row: InboxRow): Agent = machines.agent(row.machineId, row.session.backend)

    fun pinned(row: InboxRow): Boolean = row.sessionKey in marks.pinned

    fun muted(row: InboxRow): Boolean = row.sessionKey in marks.muted
}

fun inboxUiState(
    rows: List<InboxRow>,
    machines: List<MachineState>,
    filter: InboxFilter,
    query: String,
    refreshing: Boolean,
    answering: Set<String> = emptySet(),
    marks: SessionMarks = SessionMarks(),
    hasMore: Boolean = false,
): InboxUiState = InboxUiState(
    sections = sections(rows, marks.pinned, filter, query),
    health = machines.associate { it.id to it.health },
    machines = machines,
    mentions = machines.filter { it.health.needsMention }.map { MachineMention(it.id, it.name, it.health) },
    rows = rows,
    filter = filter,
    query = query,
    refreshing = refreshing,
    anyOnline = machines.any { it.health.isOnline },
    connecting = machines.any { it.health.settling },
    answering = answering,
    marks = marks,
    hasMore = hasMore,
)

/**
 * The rows the filter and the search admit: needs you, then the pinned rows that do not need the
 * person, then working, done, idle, each in the core's newest-first order; empty sections left out.
 * A filter on a state shows that state alone, pinned rows in it.
 */
fun sections(rows: List<InboxRow>, pinned: Set<SessionKey>, filter: InboxFilter, query: String): List<InboxSection> {
    val words = query.lowercase().split(' ').filter { it.isNotEmpty() }
    val shown = rows.filter { filter.admits(it) && it.matches(words) }
    filter.state?.let { state ->
        val only = shown.filter { it.state == state }
        return if (only.isEmpty()) emptyList() else listOf(InboxSection(state.group, only))
    }
    val byGroup = shown.groupBy { row ->
        when {
            row.state == InboxState.NEEDS_YOU -> InboxGroup.NEEDS_YOU
            row.sessionKey in pinned -> InboxGroup.PINNED
            else -> row.state.group
        }
    }
    return InboxGroup.entries.mapNotNull { group -> byGroup[group]?.let { InboxSection(group, it) } }
}

/** Whether its title or folder holds every word searched for. */
private fun InboxRow.matches(words: List<String>): Boolean {
    if (words.isEmpty()) return true
    val haystack = listOfNotNull(title, folderName).joinToString(" ").lowercase()
    return words.all(haystack::contains)
}

/** The last component of the folder the session runs in. */
val InboxRow.folderName: String? get() = cwd?.trimEnd('/')?.substringAfterLast('/')?.ifEmpty { null }

private val InboxState.group: InboxGroup
    get() = when (this) {
        InboxState.NEEDS_YOU -> InboxGroup.NEEDS_YOU
        InboxState.WORKING -> InboxGroup.WORKING
        InboxState.DONE -> InboxGroup.DONE
        InboxState.IDLE -> InboxGroup.IDLE
    }
