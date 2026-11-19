package com.muzammil.broski.feature.notifications

import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

/**
 * What the one Live Update says while any agent is live: how many work and how many need the
 * person, and the focused session (needs-you first, then most recently updated), with the bridge's
 * authoritative `runStartedAt` (or the first sighting as fallback for older bridges).
 */
data class LiveStatus(
    val working: Int,
    val needsYou: Int,
    val focused: InboxRow,
    val sinceMs: Long,
) {
    val target: SessionTarget get() = focused.target

    companion object {
        /** Null when nothing is live, which ends the Live Update. */
        fun of(
            rows: List<InboxRow>,
            since: MutableMap<SessionTarget, Long>,
            nowMs: Long,
            reachableMachines: Set<String>? = null,
        ): LiveStatus? {
            val reachable = rows.filter { !it.cached && (reachableMachines == null || it.machineId in reachableMachines) }
            reachable
                .filter { it.state == InboxState.DONE || it.state == InboxState.IDLE }
                .forEach { since.remove(it.target) }
            val live = reachable
                .filter { it.state == InboxState.WORKING || it.state == InboxState.NEEDS_YOU }
                .sortedWith(compareBy<InboxRow> { if (it.state == InboxState.NEEDS_YOU) 0 else 1 }.thenByDescending { it.updatedAt }.thenBy { it.session.sessionId })
            if (live.isEmpty()) {
                since.clear()
                return null
            }
            live.forEach { row ->
                val authoritative = row.runStartedAt
                if (authoritative != null) {
                    since[row.target] = authoritative
                } else {
                    since.putIfAbsent(row.target, nowMs)
                }
            }
            val focused = live.first()
            return LiveStatus(
                working = live.count { it.state == InboxState.WORKING },
                needsYou = live.count { it.state == InboxState.NEEDS_YOU },
                focused = focused,
                sinceMs = focused.runStartedAt ?: since.getValue(focused.target),
            )
        }
    }
}

val InboxRow.target: SessionTarget get() = SessionTarget(machineId, session.backend.wire, session.sessionId)

/** The backend's id on the wire (`claude-code`, `pi`), as push payloads and letters carry it. */
val uniffi.broski_contract.BackendId.wire: String get() = name.lowercase().replace('_', '-')
