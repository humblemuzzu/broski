package com.muzammil.broski.feature.inbox

import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.Agent
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
    val working: Int = 0,
    val workingOnly: Boolean = false,
    val refreshing: Boolean = false,
    val anyOnline: Boolean = false,
    val connecting: Boolean = false,
    /** Rows whose answer is on its way ([key]); their actions wait for it. */
    val answering: Set<String> = emptySet(),
    val marks: SessionMarks = SessionMarks(),
) {
    val isEmpty: Boolean get() = sections.isEmpty()

    fun agent(row: InboxRow): Agent = machines.agent(row.machineId, row.session.backend)

    fun pinned(row: InboxRow): Boolean = row.sessionKey in marks.pinned

    fun muted(row: InboxRow): Boolean = row.sessionKey in marks.muted
}

/**
 * The rows in sections, needs you → pinned → working → done → idle, empty ones left out, each keeping
 * the core's newest-first order. A pinned row waiting on the person stays in Needs you; any other
 * pinned row is listed once, under Pinned. `workingOnly` keeps every working row alone while anything works.
 */
fun inboxUiState(
    rows: List<InboxRow>,
    machines: List<MachineState>,
    workingOnly: Boolean,
    refreshing: Boolean,
    answering: Set<String> = emptySet(),
    marks: SessionMarks = SessionMarks(),
): InboxUiState {
    val working = rows.count { it.state == InboxState.WORKING }
    val filtered = workingOnly && working > 0
    val sections = if (filtered) {
        listOf(InboxSection(InboxGroup.WORKING, rows.filter { it.state == InboxState.WORKING }))
    } else {
        sections(rows, marks.pinned)
    }
    return InboxUiState(
        sections = sections,
        health = machines.associate { it.id to it.health },
        machines = machines,
        mentions = machines.filter { it.health.needsMention }.map { MachineMention(it.id, it.name, it.health) },
        working = working,
        workingOnly = filtered,
        refreshing = refreshing,
        anyOnline = machines.any { it.health.isOnline },
        connecting = machines.any { it.health.settling },
        answering = answering,
        marks = marks,
    )
}

private fun sections(rows: List<InboxRow>, pinned: Set<SessionKey>): List<InboxSection> {
    val byGroup = rows.groupBy { row ->
        when {
            row.state == InboxState.NEEDS_YOU -> InboxGroup.NEEDS_YOU
            row.sessionKey in pinned -> InboxGroup.PINNED
            else -> row.state.group
        }
    }
    return InboxGroup.entries.mapNotNull { group -> byGroup[group]?.let { InboxSection(group, it) } }
}

private val InboxState.group: InboxGroup
    get() = when (this) {
        InboxState.NEEDS_YOU -> InboxGroup.NEEDS_YOU
        InboxState.WORKING -> InboxGroup.WORKING
        InboxState.DONE -> InboxGroup.DONE
        InboxState.IDLE -> InboxGroup.IDLE
    }
