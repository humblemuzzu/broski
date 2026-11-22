package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.feature.chat.EmptySnapshot
import com.muzammil.broski.feature.chat.Items
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FollowTest {
    private val builder = RowBuilder()

    private fun rows(vararg items: uniffi.broski_contract.TranscriptItem, pending: List<PendingSend> = emptyList()) =
        builder.build(RowInput(items.toList(), EmptySnapshot, pending, hasOlder = false, now = 0))

    @Test
    fun aDragPastTheDetachDistanceDetachesAndRestingNearTheEndOrAJumpFollowsAgain() {
        assertTrue("a nudge is not leaving", Follow().dragged(travelledPx = 20, distanceFromEnd = 20, detachPx = 60).following)
        assertTrue("growth under a resting finger never detaches", Follow().dragged(travelledPx = 10, distanceFromEnd = 400, detachPx = 60).following)
        val reading = Follow().dragged(travelledPx = 80, distanceFromEnd = 400, detachPx = 60)
        assertFalse(reading.following)
        assertFalse("arrivals never move a reader", reading.arrived(3).following)
        assertEquals(3, reading.arrived(3).unseen)
        assertFalse("resting far from the end stays detached", reading.settled(distanceFromEnd = 400, followPx = 130).following)
        assertEquals(Follow(), reading.arrived(3).settled(distanceFromEnd = 100, followPx = 130))
        assertEquals(Follow(), reading.arrived(3).jumped())
        assertEquals("a follower counts nothing", Follow(), Follow().arrived(2))
    }

    @Test
    fun newMessagesCountsTheSentMessageAndEachAnswerOnceNotWorkOrMoreBlocks() {
        val before = rows(Items.user("u1", "Hi"), Items.text("t1", "Hello."))
        val after = rows(
            Items.user("u1", "Hi"),
            Items.text("t1", "Hello."),
            Items.user("u2", "More"),
            Items.call("c1", "Bash", null, "command" to "ls"),
            Items.text("t2", "One.\n\nTwo.\n\nThree."),
        )
        assertEquals(2, newMessages(before, after))
        assertEquals(0, newMessages(after, after))
    }

    @Test
    fun aMessageOnItsWayCountsAsANewMessage() {
        val before = rows(Items.user("u1", "Hi"))
        val sent = rows(Items.user("u1", "Hi"), pending = listOf(PendingSend("r1", "And this", 0)))
        assertEquals(1, newMessages(before, sent))
        assertTrue(Follow().arrived(newMessages(before, sent)).following)
    }

    @Test
    fun workFoldKeySurvivesRunEndWhenTranscriptAssignsNewIds() {
        val liveBuilder = RowBuilder()
        val liveRun = Items.run(
            Items.user("live-u1", "Check files", request = "req-1"),
            Items.call("live-c1", "Read", null, "path" to "a.kt"),
            Items.text("live-t1", "Done."),
            startedAt = 1L,
        )
        val liveRows = liveBuilder.build(RowInput(emptyList(), EmptySnapshot.copy(run = liveRun), emptyList(), hasOlder = false, now = 0))
        val liveWorkKey = liveRows.filterIsInstance<ChatRow.Work>().single().key

        val settledRows = liveBuilder.build(
            RowInput(
                history = listOf(
                    Items.user("disk-u1", "Check files", request = "req-1"),
                    Items.call("disk-c1", "Read", null, "path" to "a.kt"),
                    Items.text("disk-t1", "Done."),
                ),
                snapshot = EmptySnapshot,
                pending = emptyList(),
                hasOlder = false,
                now = 0,
            ),
        )
        val settledWorkKey = settledRows.filterIsInstance<ChatRow.Work>().single().key
        assertEquals(liveWorkKey, settledWorkKey)
    }

    @Test
    fun streamingPacerAdvancesSmoothlyWithoutSplittingSurrogates() {
        val target = "Hello world 🚀 this is a streamed burst of words."
        val step1 = StreamingPacer.advance("", target)
        assertTrue(step1.isNotEmpty() && step1.length < target.length)
        assertTrue(target.startsWith(step1))

        var current = ""
        var steps = 0
        while (current != target && steps < 100) {
            current = StreamingPacer.advance(current, target)
            steps += 1
        }
        assertEquals(target, current)
        assertTrue(steps in 2..40)
    }
}
