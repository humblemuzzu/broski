package com.muzammil.broski.feature.chat

import com.muzammil.broski.core.BackendIds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.NoticeEvent
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.OpenBlock
import uniffi.broski_contract.SessionCapabilities
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.SessionStatus
import uniffi.broski_core.SessionChange
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.ViewEnd

/**
 * The chat's copy of a view applies the core's records as they come. The equality with
 * `view.snapshot()` over a real bridge is the instrumented `SessionReplicaTest`'s; this holds what
 * the chat reads off a batch besides the state.
 */
class LiveSessionTest {
    private val session = SessionRef(BackendIds.PI, "s1")
    private val started = LiveSession().apply(
        SessionUpdate.Reset(session, SessionCapabilities(true, false, false, true), EmptySnapshot, SessionStatus.IDLE),
    ).session

    @Test
    fun aRunThatStartsAndEndsInOneBatchIsSeenToEndWithItsItems() {
        val run = Items.run()
        val applied = started.apply(
            SessionUpdate.Changes(
                listOf(
                    SessionChange.RunChanged(run),
                    SessionChange.RunItemAppended(Items.user("u1", "Go", request = "r1")),
                    SessionChange.RunItemAppended(Items.text("t1", "Done.")),
                    SessionChange.RunChanged(null),
                ),
                SessionStatus.IDLE,
            ),
        )
        assertNull(applied.session.snapshot.run)
        assertEquals(listOf("u1", "t1"), applied.endedRuns.single().items.map { it.id })
    }

    @Test
    fun textStreamsByAssignmentAndMomentsAreHandedOutNotKept() {
        val block = OpenBlock("b1", "m1", BlockKind.TEXT, null, "Hel")
        val notice = SessionChange.NoticeShown(NoticeEvent(NoticeLevel.INFO, "Halfway"))
        val applied = started.apply(
            SessionUpdate.Changes(
                listOf(SessionChange.RunChanged(Items.run()), SessionChange.BlockOpened(block), notice, SessionChange.BlockTextChanged("b1", "Hello")),
                SessionStatus.RUNNING,
            ),
        )
        assertEquals(listOf("Hello"), applied.session.snapshot.blocks.map { it.text })
        assertEquals(listOf(notice), applied.moments)
        assertEquals(SessionStatus.RUNNING, applied.session.status)
        assertEquals(emptyList<Any>(), applied.endedRuns)
    }

    @Test
    fun aResetAfterARunEndedWhileAwayEndsItAndTheFirstResetEndsNothing() {
        val first = LiveSession().apply(SessionUpdate.Reset(session, SessionCapabilities(true, false, false, true), EmptySnapshot.copy(run = Items.run()), SessionStatus.RUNNING))
        assertEquals(emptyList<Any>(), first.endedRuns)
        val again = first.session.apply(SessionUpdate.Reset(session, SessionCapabilities(true, false, false, true), EmptySnapshot, SessionStatus.IDLE))
        assertEquals(1, again.endedRuns.size)
    }

    @Test
    fun aViewAttachingAgainKeepsItsStateAndSaysItIsNotLiveUntilItIs() {
        val running = started.apply(SessionUpdate.Changes(listOf(SessionChange.RunChanged(Items.run())), SessionStatus.RUNNING)).session
        val away = running.apply(SessionUpdate.Live(false)).session
        assertTrue(away.reconnecting)
        assertEquals(running.snapshot, away.snapshot)
        assertFalse(away.apply(SessionUpdate.Live(true)).session.reconnecting)
        assertFalse("an ended view says why itself", away.apply(SessionUpdate.Ended(ViewEnd.Refused("no"))).session.reconnecting)
    }
}
