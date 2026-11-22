package com.muzammil.broski.core.vault

import com.muzammil.broski.core.BackendIds
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.SeenMarker
import uniffi.broski_core.SeenState

/** The inbox's [SeenState] as JSON, the backend spelled by its wire id. */
internal object SeenStateCodec {
    @Serializable
    private data class StoredSeen(val markers: List<StoredMarker>, val readMachines: List<String>)

    @Serializable
    private data class StoredMarker(val machineId: String, val backend: String, val sessionId: String, val seenAt: Long)

    private val json = Json { ignoreUnknownKeys = true }

    /** What builds that knew only a closed set of backends wrote: the Kotlin enum's names. */
    private val legacy = mapOf("CLAUDE_CODE" to BackendIds.CLAUDE_CODE, "PI" to BackendIds.PI)

    fun encode(state: SeenState): ByteArray {
        val stored = StoredSeen(
            markers = state.markers.map {
                StoredMarker(it.machineId, it.session.backend, it.session.sessionId, it.seenAt)
            },
            readMachines = state.readMachines,
        )
        return json.encodeToString(StoredSeen.serializer(), stored).encodeToByteArray()
    }

    /** A marker whose backend is no wire id, nor an enum name an older build wrote, is left out: it could name no session. */
    fun decode(bytes: ByteArray): SeenState {
        val stored = json.decodeFromString(StoredSeen.serializer(), bytes.decodeToString())
        return SeenState(
            markers = stored.markers.mapNotNull { marker ->
                val backend = legacy[marker.backend] ?: marker.backend.takeIf(BackendIds::isValid) ?: return@mapNotNull null
                SeenMarker(marker.machineId, SessionRef(backend, marker.sessionId), marker.seenAt)
            },
            readMachines = stored.readMachines,
        )
    }
}
