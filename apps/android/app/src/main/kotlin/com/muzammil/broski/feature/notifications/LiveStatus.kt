package com.muzammil.broski.feature.notifications

import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

/**
 * What the one Live Update says while any agent works: how many work and how many need the person,
 * and the run it follows (the one active most recently), with when the phone first saw it working.
 */
data class LiveStatus(
    val working: Int,
    val needsYou: Int,
    val focused: InboxRow,
    val sinceMs: Long,
) {
    val target: SessionTarget get() = focused.target

    companion object {
        /** Null when nothing works, which ends the Live Update. `since` keeps each run's first sighting. */
        fun of(rows: List<InboxRow>, since: MutableMap<SessionTarget, Long>, nowMs: Long): LiveStatus? {
            val working = rows.filter { it.state == InboxState.WORKING }
            since.keys.retainAll(working.map { it.target }.toSet())
            working.forEach { since.getOrPut(it.target) { nowMs } }
            val focused = working.maxByOrNull { it.updatedAt } ?: return null
            return LiveStatus(
                working = working.size,
                needsYou = rows.count { it.state == InboxState.NEEDS_YOU },
                focused = focused,
                sinceMs = since.getValue(focused.target),
            )
        }
    }
}

val InboxRow.target: SessionTarget get() = SessionTarget(machineId, session.backend.wire, session.sessionId)

/** The backend's id on the wire (`claude-code`, `pi`), as push payloads and letters carry it. */
val uniffi.broski_contract.BackendId.wire: String get() = name.lowercase().replace('_', '-')
