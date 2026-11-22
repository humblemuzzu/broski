package com.muzammil.broski.core.vault

import com.muzammil.broski.core.BackendIds
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.SeenMarker
import uniffi.broski_core.SeenState
import uniffi.broski_core.UnreadSession

/** The inbox's [SeenState] as JSON, the backend spelled by its wire id. */
internal object SeenStateCodec {
    @Serializable
    private data class StoredSeen(
        val markers: List<StoredMarker>,
        val readMachines: List<String>,
        val unread: List<StoredUnread> = emptyList(),
    )

    @Serializable
    private data class StoredMarker(val machineId: String, val backend: String, val sessionId: String, val seenAt: Long)

    @Serializable
    private data class StoredUnread(val machineId: String, val backend: String, val sessionId: String)

    private val json = Json { ignoreUnknownKeys = true }

    fun encode(state: SeenState): ByteArray {
        val stored = StoredSeen(
            markers = state.markers.map {
                StoredMarker(it.machineId, it.session.backend, it.session.sessionId, it.seenAt)
            },
            readMachines = state.readMachines,
            unread = state.unread.map { StoredUnread(it.machineId, it.session.backend, it.session.sessionId) },
        )
        return json.encodeToString(StoredSeen.serializer(), stored).encodeToByteArray()
    }

    /** An entry whose backend is no wire id, nor an enum name an older build wrote, is left out: it could name no session. */
    fun decode(bytes: ByteArray): SeenState {
        val stored = json.decodeFromString(StoredSeen.serializer(), bytes.decodeToString())
        return SeenState(
            markers = stored.markers.mapNotNull { marker ->
                val backend = wireId(marker.backend) ?: return@mapNotNull null
                SeenMarker(marker.machineId, SessionRef(backend, marker.sessionId), marker.seenAt)
            },
            readMachines = stored.readMachines,
            unread = stored.unread.mapNotNull { entry ->
                val backend = wireId(entry.backend) ?: return@mapNotNull null
                UnreadSession(entry.machineId, SessionRef(backend, entry.sessionId))
            },
        )
    }

    private fun wireId(stored: String): String? = BackendIds.fromLegacy(stored) ?: stored.takeIf(BackendIds::isValid)
}
