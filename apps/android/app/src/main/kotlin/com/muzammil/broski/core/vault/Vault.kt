package com.muzammil.broski.core.vault

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.byteArrayPreferencesKey
import androidx.datastore.preferences.core.edit
import java.io.IOException
import java.security.GeneralSecurityException
import kotlinx.coroutines.flow.first
import kotlinx.serialization.SerializationException
import uniffi.broski_core.SeenState

/** A stored value that is there but does not open: never a reason to write a new one over it. */
class UnreadableSecretException(name: String, cause: Throwable) :
    IOException("the stored $name can't be read", cause)

/** Every stored pairing; the ids of those that no longer open are kept apart, not dropped. */
class StoredRecords(val readable: Map<String, ByteArray>, val unreadable: Set<String>)

/**
 * What the app keeps between launches, each value sealed by [cipher] under its own name: the
 * phone's identity secret, each machine's record (`MachineRecord.toBytes()`, which holds the relay
 * token and push key), the inbox's seen state and its last known rows.
 */
class Vault(private val store: DataStore<Preferences>, private val cipher: SecretCipher) {

    /** `null` only on a first run; a secret that is stored but does not open throws. */
    suspend fun identity(): ByteArray? = read(IDENTITY)

    suspend fun saveIdentity(secret: ByteArray) = write(IDENTITY, secret)

    suspend fun records(): StoredRecords {
        val preferences = store.data.first()
        val readable = mutableMapOf<String, ByteArray>()
        val unreadable = mutableSetOf<String>()
        for ((key, value) in preferences.asMap()) {
            val machineId = key.name.removePrefix(RECORD_PREFIX).takeIf { it != key.name } ?: continue
            try {
                readable[machineId] = cipher.open(value as ByteArray, key.name)
            } catch (_: GeneralSecurityException) {
                unreadable += machineId
            }
        }
        return StoredRecords(readable, unreadable)
    }

    suspend fun saveRecord(machineId: String, record: ByteArray) = write(recordKey(machineId), record)

    suspend fun deleteRecord(machineId: String) {
        store.edit { it.remove(recordKey(machineId)) }
    }

    /** The identity, every record, the seen state and the cache: only when the person starts over. */
    suspend fun clear() {
        store.edit { it.clear() }
    }

    /** `null` until the inbox first reports one; a stored state that does not open throws. */
    suspend fun seen(): SeenState? = read(SEEN)?.let { bytes ->
        try {
            SeenStateCodec.decode(bytes)
        } catch (error: SerializationException) {
            throw UnreadableSecretException(SEEN.name, error)
        }
    }

    suspend fun saveSeen(state: SeenState) = write(SEEN, SeenStateCodec.encode(state))

    /** The bytes of the core's last `InboxUpdate.cache`, which only the core reads. */
    suspend fun inboxCache(): ByteArray? = read(CACHE)

    suspend fun saveInboxCache(cache: ByteArray) = write(CACHE, cache)

    /** What the person had typed in a session's composer, under the session's [name]; `null` when nothing. */
    suspend fun draft(name: String): String? = read(draftKey(name))?.decodeToString()

    /** Stores [text] as the draft, or forgets it when blank. */
    suspend fun saveDraft(name: String, text: String) {
        if (text.isBlank()) store.edit { it.remove(draftKey(name)) } else write(draftKey(name), text.encodeToByteArray())
    }

    /** The xAI key dictation sends with, sealed like everything here; `null` when none is saved. */
    suspend fun xaiKey(): String? = read(XAI_KEY)?.decodeToString()?.trim()?.ifEmpty { null }

    suspend fun saveXaiKey(key: String) = write(XAI_KEY, key.trim().encodeToByteArray())

    suspend fun deleteXaiKey() {
        store.edit { it.remove(XAI_KEY) }
    }

    /** Every draft of a machine's sessions, once the machine is forgotten. */
    suspend fun deleteDrafts(machineId: String) {
        store.edit { preferences ->
            preferences.asMap().keys.filter { it.name.startsWith("$DRAFT_PREFIX$machineId/") }.forEach { preferences.remove(it) }
        }
    }

    private suspend fun read(key: Preferences.Key<ByteArray>): ByteArray? {
        val sealed = store.data.first()[key] ?: return null
        return try {
            cipher.open(sealed, key.name)
        } catch (error: GeneralSecurityException) {
            throw UnreadableSecretException(key.name, error)
        }
    }

    private suspend fun write(key: Preferences.Key<ByteArray>, value: ByteArray) {
        val sealed = cipher.seal(value, key.name)
        store.edit { it[key] = sealed }
    }

    private companion object {
        const val RECORD_PREFIX = "machine:"
        const val DRAFT_PREFIX = "draft:"
        val IDENTITY = byteArrayPreferencesKey("identity")
        val SEEN = byteArrayPreferencesKey("seen")
        val CACHE = byteArrayPreferencesKey("cache")
        val XAI_KEY = byteArrayPreferencesKey("voice:xai-key")

        fun recordKey(machineId: String) = byteArrayPreferencesKey(RECORD_PREFIX + machineId)

        fun draftKey(name: String) = byteArrayPreferencesKey(DRAFT_PREFIX + name)
    }
}
