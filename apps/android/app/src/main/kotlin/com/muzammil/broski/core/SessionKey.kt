package com.muzammil.broski.core

import kotlinx.serialization.Serializable
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.InboxRow

/** A session on a machine, as the app's own marks on it (pinned, muted) name it. */
@Serializable
data class SessionKey(val machineId: String, val backend: String, val sessionId: String) {
    companion object {
        fun of(machineId: String, session: SessionRef) = SessionKey(machineId, session.backend, session.sessionId)
    }
}

val InboxRow.sessionKey: SessionKey get() = SessionKey.of(machineId, session)

/** What the person marked a session: kept on this phone only. */
enum class SessionMark { Pinned, Muted }
