package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.feature.chat.EmptySnapshot
import com.muzammil.broski.feature.chat.Items
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_core.markdownBlocks

/** Follow or detach, and what the jump button counts while detached. */
class FollowTest {
    private val builder = RowBuilder(::markdownBlocks)

    private fun rows(vararg items: uniffi.broski_contract.TranscriptItem, pending: List<PendingSend> = emptyList()) =
        builder.build(RowInput(items.toList(), EmptySnapshot, pending, hasOlder = false, now = 0))

    @Test
    fun onlyThePersonsScrollDetachesAndOnlyTheEndOrTheJumpFollowsAgain() {
        val reading = Follow().scrolled(atEnd = false)
        assertFalse(reading.following)
        assertFalse("arrivals never move a reader", reading.arrived(3).following)
        assertEquals(3, reading.arrived(3).unseen)
        assertEquals(Follow(), reading.arrived(3).scrolled(atEnd = true))
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
    fun aMessageSentWhileReadingIsCountedNotFollowed() {
        val before = rows(Items.user("u1", "Hi"))
        val sent = rows(Items.user("u1", "Hi"), pending = listOf(PendingSend("r1", "And this", 0)))
        val reading = Follow().scrolled(atEnd = false).arrived(newMessages(before, sent))
        assertFalse(reading.following)
        assertEquals(1, reading.unseen)
        assertTrue(Follow().arrived(newMessages(before, sent)).following)
    }
}
