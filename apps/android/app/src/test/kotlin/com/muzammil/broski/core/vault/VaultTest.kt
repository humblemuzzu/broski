package com.muzammil.broski.core.vault

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.byteArrayPreferencesKey
import androidx.datastore.preferences.core.edit
import com.muzammil.broski.core.SessionKey
import com.muzammil.broski.core.SessionMark
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
import uniffi.broski_core.MachineHistory
import uniffi.broski_core.SeenMarker
import uniffi.broski_core.SeenState
import uniffi.broski_core.UnreadSession

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
        unread = listOf(UnreadSession("m-2", SessionRef("pi", "s-4"))),
        histories = listOf(MachineHistory("m-1", 1_724_000_000_000)),
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
    fun aDraftAnOlderBuildStoredUnderTheEnumNameMovesToTheWireIdAndClearsForGood() = runBlocking {
        vault().saveDraft("m-1/CLAUDE_CODE/s-1", "half a thought")
        assertEquals("half a thought", vault().draft("m-1/claude-code/s-1", formerly = "m-1/CLAUDE_CODE/s-1"))
        assertEquals("it moved under the wire id", "half a thought", vault().draft("m-1/claude-code/s-1"))
        assertNull("and left the old name", vault().draft("m-1/CLAUDE_CODE/s-1"))

        vault().saveDraft("m-1/PI/s-2", "an older line")
        vault().saveDraft("m-1/pi/s-2", "", formerly = "m-1/PI/s-2")
        assertNull("clearing the draft clears the old name too", vault().draft("m-1/pi/s-2", formerly = "m-1/PI/s-2"))
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

    @Test
    fun aSeenStateStoredBeforeUnreadExistedReadsWithNoneAndUnreadSessionsKeepTheirWireIds() {
        val older = """{"markers":[{"machineId":"m-1","backend":"pi","sessionId":"s-1","seenAt":5}],"readMachines":[]}"""
        val read = SeenStateCodec.decode(older.encodeToByteArray())
        assertEquals(SeenState(listOf(SeenMarker("m-1", SessionRef("pi", "s-1"), 5)), emptyList(), emptyList()), read)

        val stored = """
            {"markers":[],"readMachines":[],"unread":[
              {"machineId":"m-1","backend":"CLAUDE_CODE","sessionId":"s-1"},
              {"machineId":"m-2","backend":"codex","sessionId":"s-2"},
              {"machineId":"m-2","backend":"../pi","sessionId":"s-3"}
            ]}
        """.trimIndent().encodeToByteArray()
        val migrated = SeenStateCodec.decode(stored)
        assertEquals(
            listOf(UnreadSession("m-1", SessionRef("claude-code", "s-1")), UnreadSession("m-2", SessionRef("codex", "s-2"))),
            migrated.unread,
        )
        val rewritten = SeenStateCodec.encode(migrated).decodeToString()
        assertFalse("the enum name is not written back", rewritten.contains("CLAUDE_CODE"))
        assertEquals(migrated, SeenStateCodec.decode(rewritten.encodeToByteArray()))
    }

    @Test
    fun pinsAndMutesOutliveARestartAndGoWithTheirMachineOrSession() = runBlocking {
        val kept = SessionKey("m-1", "pi", "s-1")
        val deleted = SessionKey("m-1", "claude-code", "s-2")
        val forgotten = SessionKey("m-2", "pi", "s-3")
        vault().apply {
            mark(SessionMark.Pinned) { it + kept + deleted + forgotten }
            mark(SessionMark.Muted) { it + forgotten + kept }
            mark(SessionMark.Muted) { it - kept }
        }
        val restarted = vault()
        assertEquals(setOf(kept, deleted, forgotten), restarted.marked(SessionMark.Pinned).first())
        assertEquals(setOf(forgotten), restarted.marked(SessionMark.Muted).first())

        restarted.unmark { it.machineId == "m-2" }
        restarted.unmark { it == deleted }
        assertEquals(setOf(kept), vault().marked(SessionMark.Pinned).first())
        assertTrue(vault().marked(SessionMark.Muted).first().isEmpty())
        assertTrue("marks that no longer open are none, not a failure", vault(with = newKey()).marked(SessionMark.Pinned).first().isEmpty())
    }
}
