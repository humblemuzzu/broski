package com.muzammil.broski.feature.notifications

import com.muzammil.broski.core.settings.NotificationKind
import java.io.File
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.PushNotification
import uniffi.broski_core.openNotification

/** What a push and the inbox become as notifications, before Android draws them. */
class NotificationModelTest {
    private val fixtures = File(requireNotNull(System.getProperty("broski.fixtures")))
    private val machine = "00112233445566778899aabbccddeeff"

    @Test
    fun thePinnedPushOpensIntoAnApprovalWithItsDecisionTarget() {
        val data = mapOf("m" to machine, "k" to "approval", "e" to File(fixtures, "push.txt").readText().trim())
        val push = requireNotNull(RelayPush.of(data))
        assertEquals(PushKind.Approval, push.kind)
        assertEquals(NotificationKind.NeedsYou, push.kind.preference)
        val opened = MachineRecord.fromBytes(File(fixtures, "push-record.json").readBytes()).use { openNotification(it, push.payload) }
        val alert = Alert.of(push.machineId, push.kind, opened)
        assertEquals(Channel.NeedsYou, alert.channel)
        assertEquals("Approve Bash" to "rm -rf /tmp/x", alert.title to alert.text)
        assertEquals("studio", alert.machineName)
        assertEquals(SessionTarget(machine, "claude-code", "s-1"), alert.session)
        assertEquals("req-1", alert.request)
        assertEquals("$machine/claude-code/s-1/req-1", alert.tag)
        assertEquals("$machine/claude-code/s-1", alert.group)
    }

    @Test
    fun onlyAnApprovalCarriesARequestToDecideAndDoneIsTaggedByItsSession() {
        val done = PushNotification("done", "Pi finished", "All tests pass", "studio", "pi", "s-2", null, 5uL)
        val alert = Alert.of(machine, PushKind.Done, done)
        assertEquals(Channel.Done, alert.channel)
        assertNull(alert.request)
        assertEquals("$machine/pi/s-2/done", alert.tag)
        val question = PushNotification("attention", "Pi asks", "Which file?", "studio", "pi", "s-2", "q-1", 5uL)
        assertNull(Alert.of(machine, PushKind.Attention, question).request)
    }

    @Test
    fun theRelaysOfflineAlertAndAnythingElseAreToldApart() {
        val alert = Base64.getUrlEncoder().withoutPadding().encodeToString("""{"machine":"$machine","state":"asleep","since":42}""".toByteArray())
        val push = requireNotNull(RelayPush.of(mapOf("m" to machine, "k" to "offline", "e" to alert)))
        assertEquals(OfflineAlert(machine, "asleep", 42), OfflineAlert.of(push.payload))
        assertEquals(NotificationKind.Failures, push.kind.preference)
        assertNull(OfflineAlert.of("not base64 !"))
        assertNull(RelayPush.of(mapOf("m" to machine, "k" to "generic", "e" to "x")))
        assertNull(RelayPush.of(mapOf("k" to "done", "e" to "x")))
    }

    @Test
    fun aDecisionCrossesFromReceiverToWorkerWhole() {
        val alert = Alert("t", Channel.NeedsYou, "Approve Bash", "rm", "studio", SessionTarget(machine, "claude-code", "s-1"), "req-1")
        val data = DecisionInput.write(alert, Decision.Deny)
        assertEquals(alert to Decision.Deny, DecisionInput.read(data.keyValueMap.mapValues { it.value as String }::get))
        assertNull(DecisionInput.read(data.keyValueMap.mapValues { it.value as String }.minus("request")::get))
    }

    private fun row(
        session: String,
        state: InboxState,
        updatedAt: Long,
        backend: BackendId = BackendId.PI,
        runStartedAt: Long? = null,
    ) = InboxRow(machine, "studio", SessionRef(backend, session), "Title $session", "/w", state, updatedAt, runStartedAt, null, null, null, false)

    @Test
    fun theLiveUpdateFollowsNeedsYouFirstThenNewestWorkingAndUsesRunStartedAt() {
        val since = mutableMapOf<SessionTarget, Long>()
        val first = LiveStatus.of(
            listOf(
                row("a", InboxState.WORKING, 10, runStartedAt = 500),
                row("q", InboxState.NEEDS_YOU, 5, runStartedAt = 400),
            ),
            since,
            nowMs = 1_000,
        )!!
        assertEquals(Triple(1, 1, "q"), Triple(first.working, first.needsYou, first.focused.session.sessionId))
        assertEquals(400L, first.sinceMs)

        val second = LiveStatus.of(
            listOf(
                row("a", InboxState.WORKING, 10, runStartedAt = 500),
                row("b", InboxState.WORKING, 20, BackendId.CLAUDE_CODE, runStartedAt = 900),
            ),
            since,
            nowMs = 2_000,
        )!!
        assertEquals(Triple(2, 0, "b"), Triple(second.working, second.needsYou, second.focused.session.sessionId))
        assertEquals(SessionTarget(machine, "claude-code", "b"), second.target)
        assertEquals(900L, second.sinceMs)

        val onlyNeedsYou = LiveStatus.of(listOf(row("q", InboxState.NEEDS_YOU, 25, runStartedAt = 400)), since, nowMs = 2_500)!!
        assertEquals(Triple(0, 1, "q"), Triple(onlyNeedsYou.working, onlyNeedsYou.needsYou, onlyNeedsYou.focused.session.sessionId))

        val back = LiveStatus.of(listOf(row("a", InboxState.WORKING, 30)), since, nowMs = 3_000)!!
        assertEquals("a keeps its known start time when runStartedAt is absent", 500L, back.sinceMs)
        assertNull(LiveStatus.of(listOf(row("a", InboxState.DONE, 40)), since, nowMs = 4_000))
        assertEquals(emptySet<SessionTarget>(), since.keys)
    }

    @Test
    fun pushDedupSuppressesDuplicatesAndEvictsOldestBeyondCapacity() {
        val dedup = PushDedup(capacity = 3)
        assertTrue(dedup.record("a"))
        assertFalse(dedup.record("a"))
        assertTrue(dedup.record("b"))
        assertTrue(dedup.record("c"))
        assertTrue(dedup.record("d"))
        assertTrue("oldest key 'a' was evicted", dedup.record("a"))
        assertFalse("recent key 'd' is still suppressed", dedup.record("d"))
    }
}
