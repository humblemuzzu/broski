package com.muzammil.broski.core.vault

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.SeenMarker
import uniffi.broski_core.SeenState

/** The inbox's [SeenState] as JSON, the backend spelled by its enum name. */
internal object SeenStateCodec {
    @Serializable
    private data class StoredSeen(val markers: List<StoredMarker>, val readMachines: List<String>)

    @Serializable
    private data class StoredMarker(val machineId: String, val backend: String, val sessionId: String, val seenAt: Long)

    private val json = Json { ignoreUnknownKeys = true }

    fun encode(state: SeenState): ByteArray {
        val stored = StoredSeen(
            markers = state.markers.map {
                StoredMarker(it.machineId, it.session.backend.name, it.session.sessionId, it.seenAt)
            },
            readMachines = state.readMachines,
        )
        return json.encodeToString(StoredSeen.serializer(), stored).encodeToByteArray()
    }

    /** A marker of a backend this build does not know is left out: it could name no session here. */
    fun decode(bytes: ByteArray): SeenState {
        val stored = json.decodeFromString(StoredSeen.serializer(), bytes.decodeToString())
        val backends = BackendId.entries.associateBy { it.name }
        return SeenState(
            markers = stored.markers.mapNotNull { marker ->
                val backend = backends[marker.backend] ?: return@mapNotNull null
                SeenMarker(marker.machineId, SessionRef(backend, marker.sessionId), marker.seenAt)
            },
            readMachines = stored.readMachines,
        )
    }
}
