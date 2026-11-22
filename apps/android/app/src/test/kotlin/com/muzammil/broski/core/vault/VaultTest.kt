package com.muzammil.broski.core.vault

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.byteArrayPreferencesKey
import androidx.datastore.preferences.core.edit
import java.io.File
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.SeenMarker
import uniffi.broski_core.SeenState

/**
 * The vault over a real Preferences DataStore file and real AES-GCM with a software key, the JVM's
 * stand-in for the Keystore key (the Keystore itself is exercised by the instrumented test).
 */
class VaultTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scopes = mutableListOf<CoroutineScope>()
    private val file by lazy { File(folder.root, "vault.preferences_pb") }
    private val key = newKey()

    @After
    fun closeStores() = scopes.forEach { it.cancel() }

    private fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    /** A store over the vault's file; the one before is closed first, as a new process would find it. */
    private fun store(): DataStore<Preferences> {
        scopes.forEach { it.cancel() }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also(scopes::add)
        return PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
    }

    private fun vault(with: SecretKey = key, store: DataStore<Preferences> = store()) = Vault(store, AesGcmCipher { with })

    private val seen = SeenState(
        markers = listOf(
            SeenMarker("m-1", SessionRef("claude-code", "s-9"), 1_725_000_000_000),
            SeenMarker("m-2", SessionRef("codex", "s-3"), 1_725_000_000_500),
        ),
        readMachines = listOf("m-1", "m-2"),
    )

    @Test
    fun whatIsSavedReadsBackTheSameAfterARestart() = runBlocking {
        val first = vault()
        assertNull("a first run has no identity", first.identity())
        assertNull(first.seen())
        assertNull(first.inboxCache())
        val secret = ByteArray(32) { it.toByte() }
        val cache = "{\"version\":1,\"rows\":[]}".encodeToByteArray()
        first.saveIdentity(secret)
        first.saveRecord("m-1", "record one".encodeToByteArray())
        first.saveRecord("m-2", "record two".encodeToByteArray())
        first.saveSeen(seen)
        first.saveInboxCache(cache)

        val second = vault()
        assertArrayEquals(secret, second.identity())
        val records = second.records()
        assertEquals(setOf("m-1", "m-2"), records.readable.keys)
        assertArrayEquals("record two".encodeToByteArray(), records.readable["m-2"])
        assertTrue(records.unreadable.isEmpty())
        assertEquals(seen, second.seen())
        assertArrayEquals(cache, second.inboxCache())

        second.deleteRecord("m-1")
        assertEquals(setOf("m-2"), vault().records().readable.keys)
    }

    @Test
    fun theFileHoldsNoValueInTheClear() = runBlocking {
        val secret = "a very recognisable identity secret".encodeToByteArray()
        vault().apply {
            saveIdentity(secret)
            saveRecord("m-1", "relay token 0123456789".encodeToByteArray())
        }
        val text = file.readBytes().decodeToString()
        assertFalse(text.contains("recognisable"))
        assertFalse(text.contains("relay token"))
    }

    @Test
    fun anIdentityThatDoesNotOpenIsAnErrorNeverAFirstRun() = runBlocking {
        vault().apply {
            saveIdentity(ByteArray(32) { 7 })
            saveRecord("m-1", "record".encodeToByteArray())
        }
        val withLostKey = vault(with = newKey())
        val failed = runCatching { withLostKey.identity() }.exceptionOrNull()
        assertTrue("$failed", failed is UnreadableSecretException)
        val records = withLostKey.records()
        assertTrue(records.readable.isEmpty())
        assertEquals("a record that does not open is kept and named", setOf("m-1"), records.unreadable)
    }

    @Test
    fun aSealedValueMovedUnderAnotherNameDoesNotOpen() = runBlocking {
        val store = store()
        vault(store = store).saveRecord("m-1", ByteArray(32) { 1 })
        store.edit { preferences ->
            preferences[byteArrayPreferencesKey("identity")] = preferences[byteArrayPreferencesKey("machine:m-1")]!!
        }
        val moved = runCatching { vault(store = store).identity() }.exceptionOrNull()
        assertTrue("$moved", moved is UnreadableSecretException)
        assertTrue(store.data.first().asMap().isNotEmpty())
    }

    @Test
    fun markersAnOlderBuildStoredByEnumNameReadAsWireIdsBesideAnyOtherBackend() {
        val stored = """
            {"markers":[
              {"machineId":"m-1","backend":"CLAUDE_CODE","sessionId":"s-1","seenAt":5},
              {"machineId":"m-1","backend":"PI","sessionId":"s-2","seenAt":6},
              {"machineId":"m-2","backend":"codex","sessionId":"s-3","seenAt":7},
              {"machineId":"m-2","backend":"","sessionId":"s-4","seenAt":8},
              {"machineId":"m-2","backend":"CODEX","sessionId":"s-5","seenAt":9},
              {"machineId":"m-2","backend":"../pi","sessionId":"s-6","seenAt":10}
            ],"readMachines":["m-1"]}
        """.trimIndent().encodeToByteArray()
        val migrated = SeenStateCodec.decode(stored)
        val expected = listOf(
            SeenMarker("m-1", SessionRef("claude-code", "s-1"), 5),
            SeenMarker("m-1", SessionRef("pi", "s-2"), 6),
            SeenMarker("m-2", SessionRef("codex", "s-3"), 7),
        )
        assertEquals(expected, migrated.markers)
        assertEquals(listOf("m-1"), migrated.readMachines)

        val rewritten = SeenStateCodec.encode(migrated).decodeToString()
        assertEquals(listOf("claude-code", "pi", "codex"), Regex("\"backend\":\"([^\"]*)\"").findAll(rewritten).map { it.groupValues[1] }.toList())
        assertEquals(migrated, SeenStateCodec.decode(rewritten.encodeToByteArray()))
    }
}
