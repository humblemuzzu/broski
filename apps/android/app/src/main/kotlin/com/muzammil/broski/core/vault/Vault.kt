package com.muzammil.broski.core.vault

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.byteArrayPreferencesKey
import androidx.datastore.preferences.core.edit
import com.muzammil.broski.core.SessionKey
import com.muzammil.broski.core.SessionMark
import java.io.IOException
import java.security.GeneralSecurityException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.SetSerializer
import kotlinx.serialization.json.Json
import uniffi.broski_core.SeenState

/** A stored value that is there but does not open: never a reason to write a new one over it. */
class UnreadableSecretException(name: String, cause: Throwable) :
    IOException("the stored $name can't be read", cause)

/** Every stored pairing; the ids of those that no longer open are kept apart, not dropped. */
class StoredRecords(val readable: Map<String, ByteArray>, val unreadable: Set<String>)

/**
 * What the app keeps between launches, each value sealed by [cipher] under its own name: the
 * phone's identity secret, each machine's record (`MachineRecord.toBytes()`, which holds the relay
 * token and push key), the inbox's seen state and its last known rows, and the sessions the person
 * pinned or muted.
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

    /**
     * What the person had typed in a session's composer, under the session's [name]; `null` when nothing.
     * A draft an older build stored under [formerly] moves to [name] as it is read.
     */
    suspend fun draft(name: String, formerly: String? = null): String? {
        val key = draftKey(name)
        read(key)?.let { return it.decodeToString() }
        val old = formerly?.let(::draftKey) ?: return null
        val text = read(old) ?: return null
        val sealed = cipher.seal(text, key.name)
        store.edit {
            it[key] = sealed
            it.remove(old)
        }
        return text.decodeToString()
    }

    /** Stores [text] as the draft, or forgets it when blank; either way a draft under [formerly] is gone. */
    suspend fun saveDraft(name: String, text: String, formerly: String? = null) {
        val key = draftKey(name)
        val sealed = text.takeIf { it.isNotBlank() }?.let { cipher.seal(it.encodeToByteArray(), key.name) }
        store.edit { preferences ->
            if (sealed == null) preferences.remove(key) else preferences[key] = sealed
            formerly?.let { preferences.remove(draftKey(it)) }
        }
    }

    /** The xAI key dictation sends with, sealed like everything here; `null` when none is saved. */
    suspend fun xaiKey(): String? = read(XAI_KEY)?.decodeToString()?.trim()?.ifEmpty { null }

    suspend fun saveXaiKey(key: String) = write(XAI_KEY, key.trim().encodeToByteArray())

    suspend fun deleteXaiKey() {
        store.edit { it.remove(XAI_KEY) }
    }

    /** The sessions marked [mark], again after each change; a stored set that does not open reads as none. */
    fun marked(mark: SessionMark): Flow<Set<SessionKey>> = store.data.map { marks(it, mark) }.distinctUntilChanged()

    /** Changes the sessions marked [mark] in one transaction, so two changes at once never undo each other. */
    suspend fun mark(mark: SessionMark, change: (Set<SessionKey>) -> Set<SessionKey>) {
        val key = markKey(mark)
        store.edit { preferences ->
            val next = change(marks(preferences, mark))
            preferences[key] = cipher.seal(json.encodeToString(KEYS, next).encodeToByteArray(), key.name)
        }
    }

    /** Every mark on a session matching [which]: its machine forgotten, or the session deleted. */
    suspend fun unmark(which: (SessionKey) -> Boolean) {
        SessionMark.entries.forEach { mark -> mark(mark) { keys -> keys.filterNot(which).toSet() } }
    }

    private fun marks(preferences: Preferences, mark: SessionMark): Set<SessionKey> {
        val key = markKey(mark)
        val sealed = preferences[key] ?: return emptySet()
        return try {
            json.decodeFromString(KEYS, cipher.open(sealed, key.name).decodeToString())
        } catch (_: GeneralSecurityException) {
            emptySet()
        } catch (_: SerializationException) {
            emptySet()
        }
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
        val KEYS = SetSerializer(SessionKey.serializer())
        val json = Json { ignoreUnknownKeys = true }

        fun markKey(mark: SessionMark) = byteArrayPreferencesKey("marks:${mark.name.lowercase()}")

        fun recordKey(machineId: String) = byteArrayPreferencesKey(RECORD_PREFIX + machineId)

        fun draftKey(name: String) = byteArrayPreferencesKey(DRAFT_PREFIX + name)
    }
}
