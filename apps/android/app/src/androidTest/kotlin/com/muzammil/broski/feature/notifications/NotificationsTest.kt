package com.muzammil.broski.feature.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import android.os.SystemClock
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.muzammil.broski.Shots
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.core.vault.AesGcmCipher
import com.muzammil.broski.core.vault.KeystoreKey
import com.muzammil.broski.core.vault.Vault
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.PushDecision
import uniffi.broski_core.decisionLetter

/**
 * Push without Firebase: the facade's pinned push (push.md's vectors) fed to the handler FCM would
 * call, with its record stored in a Keystore-sealed vault, and decisions POSTed to a local relay.
 */
class NotificationsTest {
    @get:Rule
    val permission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val machine = "00112233445566778899aabbccddeeff"
    private val server = MockWebServer()

    private fun fixture(name: String) = InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { it.readBytes() }

    private val push = mapOf("m" to machine, "k" to "approval", "e" to fixture("push.txt").decodeToString().trim())

    @After
    fun tearDown() {
        manager.cancelAll()
        scope.cancel()
        server.close()
    }

    private suspend fun vault(): Vault {
        val file = File(context.cacheDir, "notifications-test-${System.nanoTime()}.preferences_pb")
        val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
        return Vault(store, AesGcmCipher { KeystoreKey.obtain() }).also { it.saveRecord(machine, fixture("push-record.json")) }
    }

    /** The notification posted under `tag` once it says what `holds` checks; posting reaches the system a moment later. */
    private fun posted(tag: String, holds: (Notification) -> Boolean = { true }): Notification {
        val deadline = SystemClock.uptimeMillis() + POST_WAIT_MS
        while (true) {
            manager.activeNotifications.firstOrNull { it.tag == tag }?.notification?.takeIf(holds)?.let { return it }
            check(SystemClock.uptimeMillis() < deadline) { "nothing posted under $tag" }
            Thread.sleep(POLL_MS)
        }
    }

    private fun text(notification: Notification) = notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString()

    /** Nothing of this test's machine shows (the app's own Live Update may). */
    private fun nothingPosted() = manager.activeNotifications.none { it.tag?.startsWith(machine) == true }

    @Test
    fun theSealedPushOpensIntoAnApprovalWithDenyAndAllow() = runBlocking<Unit> {
        val alert = requireNotNull(PushHandler(context, vault(), { NotificationKind.entries.toSet() }).handle(push))
        val notification = posted(alert.tag)
        assertEquals("Approve Bash", notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("rm -rf /tmp/x", notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals("studio", notification.extras.getCharSequence(Notification.EXTRA_SUB_TEXT).toString())
        assertEquals(Channel.NeedsYou.id, notification.channelId)
        assertEquals(listOf("Deny", "Allow"), notification.actions.map { it.title.toString() })
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            assertEquals(listOf(false, true), notification.actions.map { it.isAuthenticationRequired })
        }
        Shots.shade("notification-approval-shade")
    }

    @Test
    fun aKindTurnedOffInSettingsPostsNothing() = runBlocking<Unit> {
        val handler = PushHandler(context, vault(), { setOf(NotificationKind.Done, NotificationKind.Failures) })
        assertNull(handler.handle(push))
        assertTrue(nothingPosted())
    }

    @Test
    fun aPushForAMachineThatIsNotPairedPostsNothing() = runBlocking<Unit> {
        val handler = PushHandler(context, vault(), { NotificationKind.entries.toSet() })
        assertNull(handler.handle(push + ("m" to "ffffffffffffffffffffffffffffffff")))
        assertTrue(nothingPosted())
    }

    /** The record of the fixture, with its relay on this device's loopback, where the letter goes over plain HTTP. */
    private fun localRecord(): ByteArray {
        server.start()
        return fixture("push-record.json").decodeToString()
            .replace("wss://relay.example/base", "ws://127.0.0.1:${server.port}/base")
            .encodeToByteArray()
    }

    @Test
    fun aLetterIsPostedExactlyAsTheCoreSealedIt() {
        val record = localRecord()
        server.enqueue(MockResponse.Builder().code(202).build())
        val letter = MachineRecord.fromBytes(record).use { decisionLetter(it, PushDecision.ALLOW, "claude-code", "s-1", "req-1") }
        assertEquals(202, postLetter(letter))
        val request = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
        assertEquals("POST", request.method)
        assertEquals("/v1/letters", request.url.encodedPath)
        letter.headers.forEach { assertEquals(it.name, it.value, request.headers[it.name]) }
        assertArrayEquals(letter.body, requireNotNull(request.body).toByteArray())
    }

    @Test
    fun theWorkerSendsTheDecisionAndSaysSoOnTheApproval() = runBlocking<Unit> {
        val vault = (context.applicationContext as BroskiApplication).core.vault
        vault.saveRecord(machine, localRecord())
        try {
            server.enqueue(MockResponse.Builder().code(202).build())
            val alert = Alert("decision-test", Channel.NeedsYou, "Approve Bash", "rm -rf /tmp/x", "studio", SessionTarget(machine, "claude-code", "s-1"), "req-1")
            val worker = TestListenableWorkerBuilder<DecisionWorker>(context.applicationContext).setInputData(DecisionInput.write(alert, Decision.Deny)).build()
            assertEquals(ListenableWorker.Result.success(), worker.doWork())
            val request = requireNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            assertEquals(machine, request.headers["x-broski-machine"])
            assertEquals("Bearer token", request.headers["authorization"])
            val notification = posted(alert.tag) { text(it) == "Denied" }
            assertTrue(notification.actions.isNullOrEmpty())
        } finally {
            vault.deleteRecord(machine)
        }
    }

    @Test
    fun aRelayThatRefusesTheLetterIsSaidPlainly() = runBlocking<Unit> {
        val vault = (context.applicationContext as BroskiApplication).core.vault
        vault.saveRecord(machine, localRecord())
        try {
            server.enqueue(MockResponse.Builder().code(401).build())
            val alert = Alert("decision-refused", Channel.NeedsYou, "Approve Bash", "rm -rf /tmp/x", "studio", SessionTarget(machine, "claude-code", "s-1"), "req-1")
            val worker = TestListenableWorkerBuilder<DecisionWorker>(context.applicationContext).setInputData(DecisionInput.write(alert, Decision.Allow)).build()
            assertEquals(ListenableWorker.Result.failure(), worker.doWork())
            posted(alert.tag) { text(it) == "Couldn't reach your Mac. Open Broski to answer." }
        } finally {
            vault.deleteRecord(machine)
        }
    }

    private companion object {
        const val POST_WAIT_MS = 5_000L
        const val POLL_MS = 100L
    }
}
