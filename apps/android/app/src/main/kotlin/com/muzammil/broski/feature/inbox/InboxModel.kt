package com.muzammil.broski.feature.inbox

import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.needsMention
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

@Immutable
data class InboxSection(val state: InboxState, val rows: List<InboxRow>)

/** A machine the inbox has to say something about, with its sessions' status. */
@Immutable
data class MachineMention(val id: String, val name: String, val health: MachineHealth)

@Immutable
data class InboxUiState(
    val sections: List<InboxSection> = emptyList(),
    val health: Map<String, MachineHealth> = emptyMap(),
    val mentions: List<MachineMention> = emptyList(),
    val working: Int = 0,
    val workingOnly: Boolean = false,
    val refreshing: Boolean = false,
    val anyOnline: Boolean = false,
) {
    val isEmpty: Boolean get() = sections.isEmpty()
}

/**
 * The rows in sections, needs you → working → done → idle, empty ones left out, each keeping the
 * core's newest-first order. `workingOnly` keeps the working section alone while anything works.
 */
fun inboxUiState(
    rows: List<InboxRow>,
    machines: List<MachineState>,
    workingOnly: Boolean,
    refreshing: Boolean,
): InboxUiState {
    val byState = rows.groupBy { it.state }
    val working = byState[InboxState.WORKING].orEmpty().size
    val filtered = workingOnly && working > 0
    val sections = InboxState.entries
        .filter { !filtered || it == InboxState.WORKING }
        .mapNotNull { state -> byState[state]?.let { InboxSection(state, it) } }
    return InboxUiState(
        sections = sections,
        health = machines.associate { it.id to it.health },
        mentions = machines.filter { it.health.needsMention }.map { MachineMention(it.id, it.name, it.health) },
        working = working,
        workingOnly = filtered,
        refreshing = refreshing,
        anyOnline = machines.any { it.health.isOnline },
    )
}
