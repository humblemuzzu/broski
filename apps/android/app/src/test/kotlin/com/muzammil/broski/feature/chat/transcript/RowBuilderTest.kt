package com.muzammil.broski.feature.chat.transcript

import com.muzammil.broski.feature.chat.EmptySnapshot
import com.muzammil.broski.feature.chat.Items
import com.muzammil.broski.feature.chat.work.FoldLead
import com.muzammil.broski.feature.chat.work.WorkEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BlockKind
import uniffi.broski_contract.OpenBlock
import uniffi.broski_contract.RunAborted
import uniffi.broski_contract.RunBoundaryItem
import uniffi.broski_contract.RunOutcome
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.ToolOutcome
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_core.FoldCount
import uniffi.broski_core.FoldVerb
import uniffi.broski_core.markdownBlocks

/** The transcript's rows from real contract items, parsed by the real core's markdown. */
class RowBuilderTest {
    private val builder = RowBuilder(::markdownBlocks)

    private fun build(
        history: List<TranscriptItem> = emptyList(),
        snapshot: SessionSnapshot = EmptySnapshot,
        pending: List<PendingSend> = emptyList(),
        hasOlder: Boolean = false,
    ) = builder.build(RowInput(history, snapshot, pending, hasOlder, now = 100_000)).reversed()

    private val finishedTurn = listOf(
        Items.user("u1", "Tidy up", at = 0),
        Items.text("th", "Let me look.", at = 1_000, kind = BlockKind.THINKING),
        Items.call("c1", "Read", 2_000, "file_path" to "a.md"),
        Items.result("c1", 3_000),
        Items.call("c2", "Bash", 4_000, "command" to "npm test"),
        Items.result("c2", 5_000, outcome = ToolOutcome.FAILED, exitCode = 1),
        Items.call("c3", "Edit", 6_000, "file_path" to "b.md"),
        Items.result("c3", 6_500, changes = listOf(Items.change("b.md"))),
        Items.text("t1", "Done, **both** files.", at = 7_000),
    )

    @Test
    fun aFinishedTurnIsTheMessageOneFoldOfItsWorkTheAnswerAndItsCopy() {
        val rows = build(history = finishedTurn)
        assertEquals(listOf("u:u1", "w:th", "t:t1/p-0", "copy:t1"), rows.map { it.key })
        val fold = (rows[1] as ChatRow.Work).fold
        assertEquals(FoldLead.Worked, fold.lead)
        assertEquals(6_500L, fold.durationMs)
        assertEquals(
            listOf(
                FoldCount(FoldVerb.EDITED, 1u, "Edited 1 file"),
                FoldCount(FoldVerb.RAN, 1u, "Ran 1 command"),
                FoldCount(FoldVerb.USED, 1u, "Used 1 tool"),
            ),
            fold.counts,
        )
        assertEquals(1, fold.failed)
        assertFalse(fold.live)
        assertEquals(listOf("Thought", "Read a.md", "npm test", "Edited b.md"), fold.entries.map { (it as? WorkEntry.Tool)?.label ?: "Thought" })
        assertEquals("Done, **both** files.", (rows[3] as ChatRow.CopyAnswer).text)
    }

    @Test
    fun aLiveRunsFoldIsLiveWithNoDurationAndItsOpenBlockKeepsItsKeyWhenItCloses() {
        val run = Items.run(Items.user("u1", "Go", at = 0, request = "r1"), Items.call("c1", "Bash", 1_000, "command" to "ls"))
        val open = OpenBlock("b1", "m1", BlockKind.TEXT, null, "First paragraph.\n\nSecond, still stream")
        val streaming = build(snapshot = EmptySnapshot.copy(run = run, blocks = listOf(open)))
        val fold = (streaming.single { it is ChatRow.Work } as ChatRow.Work).fold
        assertTrue(fold.live)
        assertNull(fold.durationMs)
        assertTrue(streaming.none { it is ChatRow.CopyAnswer })

        val closed = run.copy(items = run.items + Items.result("c1", 1_500) + Items.text("b1", "First paragraph.\n\nSecond, streamed whole."))
        val finished = build(snapshot = EmptySnapshot.copy(run = closed))
        val keys = { rows: List<ChatRow> -> rows.filterIsInstance<ChatRow.Text>().map { it.key } }
        assertEquals(keys(streaming), keys(finished))
        assertFalse((finished.single { it is ChatRow.Work } as ChatRow.Work).fold.live)
    }

    @Test
    fun aSentMessageIsOneRowFromItsSendToTheAgentsUserMessage() {
        val sent = build(pending = listOf(PendingSend("r1", "Go", at = 99_000)))
        assertEquals(listOf("c:r1"), sent.map { it.key })
        assertTrue((sent.single() as ChatRow.User).pending)

        val shown = build(snapshot = EmptySnapshot.copy(run = Items.run(Items.user("u1", "Go", request = "r1"))), pending = listOf(PendingSend("r1", "Go", 99_000)))
        assertEquals(listOf("c:r1"), shown.map { it.key })
        assertFalse((shown.single() as ChatRow.User).pending)
    }

    @Test
    fun workAfterASteerContinuesAndALaterStretchOfTheSameTurnHasNoLead() {
        val run = Items.run(
            Items.user("u1", "Go", at = 0),
            Items.call("c1", "Bash", 1_000, "command" to "ls"),
            Items.result("c1", 2_000),
            Items.text("t1", "Listed."),
            Items.call("c2", "Bash", 3_000, "command" to "pwd"),
            Items.result("c2", 3_500),
            Items.user("u2", "Also this", at = 4_000),
            Items.call("c3", "Grep", 5_000, "pattern" to "todo"),
            Items.result("c3", 6_000),
        )
        val leads = build(snapshot = EmptySnapshot.copy(run = run)).filterIsInstance<ChatRow.Work>().map { it.fold.lead }
        assertEquals(listOf(FoldLead.Worked, FoldLead.None, FoldLead.Continued), leads)
    }

    @Test
    fun theCopyButtonSitsUnderTheAnswerAboveTheNoteOfHowTheRunEnded() {
        val stopped = TranscriptItem.RunBoundary(RunBoundaryItem("end", 3_000, RunOutcome.Aborted(RunAborted())))
        val rows = build(history = listOf(Items.user("u1", "Go"), Items.text("t1", "Working."), stopped))
        assertEquals(listOf("u:u1", "t:t1/p-0", "copy:t1", "n:end"), rows.map { it.key })
    }

    @Test
    fun anItemTheTranscriptAndTheRunBothHoldIsOneRowAndOlderPagesAreAskedForAtTheTop() {
        val item = Items.user("u1", "Once", at = 0)
        val rows = build(history = listOf(item), snapshot = EmptySnapshot.copy(run = Items.run(item)), hasOlder = true)
        assertEquals(listOf("older", "u:u1"), rows.map { it.key })
    }
}
