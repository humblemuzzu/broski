package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.feature.chat.EmptySnapshot
import com.muzammil.broski.feature.chat.Items
import com.muzammil.broski.feature.chat.work.FoldLead
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.OpenBlock
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.TranscriptItem

/** A turn's work folding into one line above its answer, and what the transcript draws of it. */
class WorkGroupsTest {
    private fun build(vararg items: TranscriptItem, snapshot: SessionSnapshot = EmptySnapshot) =
        RowBuilder().build(RowInput(items.toList(), snapshot, emptyList(), hasOlder = false, now = 0)).reversed()

    private fun kinds(rows: List<ChatRow>) = rows.map { it::class.simpleName }

    /** Thinking, a note, a read, another note, a command and the answer, over 2m 20s. */
    private val longTurn = arrayOf(
        Items.user("u1", "Go", at = 0),
        Items.text("t1", "Plan", at = 1_000, kind = BlockKind.THINKING),
        Items.text("b1", "Let me look.", at = 2_000),
        Items.call("c1", "Read", 3_000, "file_path" to "/w/a.md"),
        Items.result("c1", 4_000),
        Items.text("b2", "Now the fix.", at = 5_000),
        Items.call("c2", "Bash", 6_000, "command" to "make"),
        Items.result("c2", 134_000),
        Items.text("b3", "Done.", at = 140_000),
    )

    @Test
    fun aTurnsStretchesAndNotesFoldUnderOneLineFromTheMessageToTheLastCall() {
        val rows = build(*longTurn)
        assertEquals(listOf("User", "WorkGroup", "Work", "Text", "Work", "Text", "Work", "Text", "CopyAnswer"), kinds(rows))
        val group = rows[1] as ChatRow.WorkGroup
        assertEquals(5, group.members)
        assertEquals(134_000L, group.summary.durationMs)
        assertEquals(FoldLead.Worked, group.summary.lead)
        assertEquals(listOf("Ran 1 command", "Read 1 file"), group.summary.counts.map { it.phrase })
        assertEquals("what a copy takes is the answer, not the notes before it", "Done.", (rows.last() as ChatRow.CopyAnswer).text)
    }

    @Test
    fun oneStretchBeforeTheAnswerIsAlreadyOneLine() {
        val rows = build(
            Items.user("u1", "Go", at = 0),
            Items.call("c1", "Read", 1_000, "file_path" to "a"),
            Items.result("c1", 2_000),
            Items.text("b1", "Hi.", at = 3_000),
        )
        assertEquals(listOf("User", "Work", "Text", "CopyAnswer"), kinds(rows))
    }

    @Test
    fun aTurnThatEndsOnACallFoldsAllOfItAndHasNoAnswerToCopy() {
        val rows = build(
            Items.user("u1", "Go", at = 0),
            Items.text("b1", "Checking.", at = 1_000),
            Items.call("c1", "Read", 2_000, "file_path" to "a"),
            Items.call("c2", "Bash", 3_000, "command" to "ls"),
            Items.result("c2", 9_000),
        )
        assertEquals(listOf("User", "WorkGroup", "Text", "Work"), kinds(rows))
        assertEquals(listOf("User", "WorkGroup"), kinds(WorkGroups.shown(rows.reversed(), collapsing = true) { false }.rows.reversed()))
    }

    @Test
    fun aNoteOrAnActivityEndsAStretchSoAnAnswerBeforeItIsNeverFolded() {
        val rows = build(
            Items.user("u1", "Go", at = 0),
            Items.call("c1", "Read", 1_000, "file_path" to "a"),
            Items.text("b1", "Started.", at = 2_000),
            Items.call("c2", "Bash", 3_000, "command" to "ls"),
            Items.notice("n1", "Rate limited", at = 4_000),
            Items.call("c3", "Grep", 5_000, "pattern" to "x"),
            Items.text("b2", "Done.", at = 6_000),
        )
        assertEquals(listOf("User", "WorkGroup", "Work", "Text", "Work", "Note", "Work", "Text", "CopyAnswer"), kinds(rows))
        val drawn = WorkGroups.shown(rows.reversed(), collapsing = true) { false }.rows.reversed()
        assertEquals(listOf("User", "WorkGroup", "Note", "Work", "Text", "CopyAnswer"), kinds(drawn))
    }

    @Test
    fun eachTurnFoldsOnItsOwnAndItsKeyIsItsFirstRows() {
        val turn = { n: Int ->
            val base = n * 1_000_000L
            arrayOf(
                Items.user("u$n", "Go", at = base),
                Items.call("a$n", "Read", base + 1_000, "file_path" to "x"),
                Items.text("n$n", "Next.", at = base + 2_000),
                Items.call("b$n", "Bash", base + 3_000, "command" to "ls"),
                Items.text("f$n", "Answer $n", at = base + 40_000),
            )
        }
        val rows = build(*turn(1), *turn(2))
        val groups = rows.filterIsInstance<ChatRow.WorkGroup>()
        assertEquals(listOf("g:w:a1", "g:w:a2"), groups.map { it.key })
        assertEquals(listOf(3_000L, 3_000L), groups.map { it.summary.durationMs })
    }

    @Test
    fun aLiveRunsGroupIsLiveWithNoDurationUntilTheAnswerStreams() {
        val working = Items.run(
            Items.user("u1", "Go", at = 0),
            Items.text("b1", "Let me run it.", at = 1_000),
            Items.call("c1", "Bash", 2_000, "command" to "make"),
        )
        val live = build(snapshot = EmptySnapshot.copy(run = working)).filterIsInstance<ChatRow.WorkGroup>().single()
        assertTrue(live.summary.live)
        assertNull(live.summary.durationMs)

        val answering = working.copy(items = working.items + Items.result("c1", 9_000))
        val open = OpenBlock("b2", "m", BlockKind.TEXT, null, "All gre")
        val settled = build(snapshot = EmptySnapshot.copy(run = answering, blocks = listOf(open))).filterIsInstance<ChatRow.WorkGroup>().single()
        assertFalse(settled.summary.live)
        assertEquals(9_000L, settled.summary.durationMs)
    }

    @Test
    fun aPageCutInsideATurnFoldsWithoutAStartRatherThanStatingAWrongTime() {
        val rows = build(
            Items.call("c1", "Read", 10_000, "file_path" to "a"),
            Items.result("c1", 11_000),
            Items.text("b1", "Now.", at = 12_000),
            Items.call("c2", "Bash", 13_000, "command" to "ls"),
            Items.result("c2", 20_000),
            Items.text("b2", "Done.", at = 21_000),
        )
        assertNull(rows.filterIsInstance<ChatRow.WorkGroup>().single().summary.durationMs)
    }

    @Test
    fun foldingOffDrawsTheRowsAsTheyWereAndOpeningAGroupDrawsItsRowsBelowIt() {
        val rows = build(*longTurn).reversed()
        val flat = rows.filterNot { it is ChatRow.WorkGroup }
        assertEquals(flat, WorkGroups.shown(rows, collapsing = false) { true }.rows)

        val closed = WorkGroups.shown(rows, collapsing = true) { false }
        assertEquals(listOf("CopyAnswer", "Text", "WorkGroup", "User"), kinds(closed.rows))
        assertTrue(closed.revealed.isEmpty())

        val group = rows.single { it is ChatRow.WorkGroup }
        val open = WorkGroups.shown(rows, collapsing = true) { it == group.key }
        assertEquals(rows, open.rows)
        assertEquals(rows.filter { it !is ChatRow.User && it !is ChatRow.WorkGroup && it !is ChatRow.CopyAnswer && it.key != "t:b3/p-0" }.map { it.key }.toSet(), open.revealed)
    }

    @Test
    fun aRunsGroupKeepsItsKeyWhenTheTranscriptReplacesItsLiveRows() {
        val turn = { prefix: String ->
            arrayOf(
                Items.user("u", "Go", request = "r1"),
                Items.text("${prefix}b1", "Look."),
                Items.call("${prefix}c1", "Read", null, "file_path" to "a"),
                Items.result("${prefix}c1"),
                Items.text("${prefix}b2", "Done."),
            )
        }
        val live = build(*turn("live-"))
        val history = build(*turn("saved-"))
        val aliases = HashMap<String, String>()
        RowAliases.learn(live, history, aliases)
        assertEquals(live.single { it is ChatRow.WorkGroup }.key, aliases[history.single { it is ChatRow.WorkGroup }.key])
    }
}
