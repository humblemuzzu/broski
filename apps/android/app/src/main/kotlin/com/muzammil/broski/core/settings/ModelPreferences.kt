package com.muzammil.broski.core.settings

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The models the person pinned for each agent, in the order pinned, and the thinking level they last
 * chose on each model, kept on this phone. Keyed by backend and model id, not by Mac: the same agent on
 * two Macs usually lists the same models, and a pin whose model a Mac does not list is only hidden there.
 */
@Serializable
data class ModelPreferences(
    val pins: Map<String, List<String>> = emptyMap(),
    val levels: Map<String, Map<String, String>> = emptyMap(),
) {
    fun pinned(backend: String): List<String> = pins[backend].orEmpty()

    fun isPinned(modelId: String, backend: String): Boolean = modelId in pinned(backend)

    fun canPin(backend: String): Boolean = pinned(backend).size < PIN_LIMIT

    fun level(modelId: String, backend: String): String? = levels[backend]?.get(modelId)

    fun pinning(pin: Boolean, modelId: String, backend: String): ModelPreferences {
        val list = pinned(backend)
        val next = when {
            !pin -> list - modelId
            modelId in list || list.size >= PIN_LIMIT -> return this
            else -> list + modelId
        }
        return copy(pins = if (next.isEmpty()) pins - backend else pins + (backend to next))
    }

    fun remembering(level: String, modelId: String, backend: String): ModelPreferences =
        copy(levels = levels + (backend to (levels[backend].orEmpty() + (modelId to level))))

    fun encoded(): String = Json.encodeToString(serializer(), this)

    companion object {
        const val PIN_LIMIT = 10

        /** Unreadable preferences are none: nothing in them is worth refusing to start over. */
        fun decoded(stored: String?): ModelPreferences = stored?.let {
            try {
                Json.decodeFromString(serializer(), it)
            } catch (_: SerializationException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        } ?: ModelPreferences()
    }
}
