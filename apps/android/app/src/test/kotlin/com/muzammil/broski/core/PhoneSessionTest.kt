package com.muzammil.broski.core

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.muzammil.broski.core.vault.AesGcmCipher
import com.muzammil.broski.core.vault.Vault
import java.io.File
import javax.crypto.KeyGenerator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.InboxState
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.Phone
import uniffi.broski_core.PhoneConfig
import uniffi.broski_core.Platform
import uniffi.broski_core.UnreadSession

/** [PhoneSession] over the real core and a real vault, with the facade's fixture machine (its one route refuses connections). */
class PhoneSessionTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val fixtures = File(requireNotNull(System.getProperty("broski.fixtures")))

    @After
    fun tearDown() = scope.cancel()

    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val vault by lazy {
        Vault(
            PreferenceDataStoreFactory.create(scope = scope, produceFile = { File(folder.root, "vault.preferences_pb") }),
            AesGcmCipher { key },
        )
    }

    private fun phone() = Phone(
        File(fixtures, "device-secret.bin").readBytes(),
        PhoneConfig("Test Pixel", Platform.ANDROID, "Broski tests", "0.0.0"),
    )

    /** A cold start with the machine unreachable shows the inbox the core last handed over, with nothing to answer. */
    @Test
    fun aColdStartShowsTheCachedRowsOfAnUnreachableMachine() = runBlocking {
        vault.saveInboxCache(File(fixtures, "inbox-cache.json").readBytes())
        val phone = phone()
        phone.inbox().use { vault.restoreInbox(it) }
        val machine = MachineRecord.fromBytes(File(fixtures, "record.json").readBytes()).use(phone::start)
        val session = PhoneSession(phone, vault, scope, listOf(machine), emptySet())

        val rows = session.inboxRows.value
        assertEquals(listOf("s-ask", "s-old"), rows.map { it.session.sessionId })
        assertTrue(rows.all { it.cached && it.pending == null })
        assertEquals("npm test", rows.first().command)
    }

    @Test
    fun aDraftAnOlderBuildKeptUnderTheBackendsEnumNameOpensInItsSession() = runBlocking {
        vault.saveDraft("m-1/PI/s-1", "rename the flag")
        val session = PhoneSession(phone(), vault, scope, emptyList(), emptySet())

        assertEquals("rename the flag", session.draft("m-1", SessionRef("pi", "s-1")))
        assertEquals("rename the flag", vault.draft("m-1/pi/s-1"))
        assertNull(vault.draft("m-1/PI/s-1"))
        assertNull("a backend no older build knew has no former name", session.draft("m-1", SessionRef("codex", "s-1")))
    }

    @Test
    fun aHandleOnAForgottenMachineStaysUsable() = runBlocking {
        val phone = phone()
        val record = File(fixtures, "record.json").readBytes()
        val machine = MachineRecord.fromBytes(record).use(phone::start)
        val id = machine.id()
        vault.saveRecord(id, record)
        val session = PhoneSession(phone, vault, scope, listOf(machine), emptySet())

        session.forget(id)

        assertNull(session.machine(id))
        assertTrue(session.machines.value.isEmpty())
        assertTrue(vault.records().readable.isEmpty())
        assertEquals(id, machine.id())
        assertEquals(id, machine.record().use { it.id() })
    }

    private suspend fun started(): Pair<PhoneSession, String> {
        val phone = phone()
        phone.inbox().use { vault.restoreInbox(it) }
        val machine = MachineRecord.fromBytes(File(fixtures, "record.json").readBytes()).use(phone::start)
        return PhoneSession(phone, vault, scope, listOf(machine), emptySet()) to machine.id()
    }

    private fun PhoneSession.states() = inboxRows.value.associate { it.session.sessionId to it.state }

    /** The fixture cache's `s-old` is idle; marked unread it is Done, and the vault keeps it so past a restart. */
    @Test
    fun aSessionMarkedUnreadIsStoredAndStillDoneAfterARestart() = runBlocking {
        vault.saveInboxCache(File(fixtures, "inbox-cache.json").readBytes())
        val old = SessionRef("pi", "s-old")
        val (first, id) = started()
        assertEquals(InboxState.IDLE, first.states()["s-old"])

        first.markUnread(id, old)
        withTimeout(5_000) {
            while (first.states()["s-old"] != InboxState.DONE || vault.seen()?.unread.isNullOrEmpty()) delay(20)
        }
        assertEquals(listOf(UnreadSession(id, old)), vault.seen()?.unread)

        val (restarted, _) = started()
        assertEquals(InboxState.DONE, restarted.states()["s-old"])
    }

    @Test
    fun pinsAndMutesShowAtOnceAndForgettingTheMachineTakesThemAway() = runBlocking {
        val (session, id) = started()
        val pinned = SessionKey(id, "pi", "s-old")
        val muted = SessionKey(id, "claude-code", "s-ask")
        val elsewhere = SessionKey("another-machine", "pi", "s-1")
        session.setMarked(SessionMark.Pinned, pinned, true)
        session.setMarked(SessionMark.Pinned, elsewhere, true)
        session.setMarked(SessionMark.Muted, muted, true)
        withTimeout(5_000) { session.muted.first { it == setOf(muted) } }
        assertEquals(setOf(pinned, elsewhere), withTimeout(5_000) { session.pinned.first { it.size == 2 } })

        session.sessionDeleted(elsewhere)
        withTimeout(5_000) { session.pinned.first { it == setOf(pinned) } }
        session.forget(id)
        assertTrue(vault.marked(SessionMark.Pinned).first().isEmpty())
        assertTrue(vault.marked(SessionMark.Muted).first().isEmpty())
    }
}
