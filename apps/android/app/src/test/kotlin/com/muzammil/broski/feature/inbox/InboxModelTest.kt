package com.muzammil.broski.feature.inbox

import com.muzammil.broski.core.BackendIds
import com.muzammil.broski.core.InboxFilter
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.SessionKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState
import uniffi.broski_core.LinkRoute
import uniffi.broski_core.WaitReason

class InboxModelTest {
    private fun row(id: String, state: InboxState, updatedAt: Long, machine: String = "m-1") = InboxRow(
        machineId = machine,
        machineName = if (machine == "m-1") "MacBook" else "Studio",
        session = SessionRef(if (id.startsWith("cc")) BackendIds.CLAUDE_CODE else BackendIds.PI, id),
        title = "Session $id",
        cwd = "/Users/me/src/broski",
        state = state,
        updatedAt = updatedAt,
        runStartedAt = null,
        ask = if (state == InboxState.NEEDS_YOU) "Allow Bash command?" else null,
        command = if (state == InboxState.NEEDS_YOU) "npm test" else null,
        pending = null,
        cached = false,
    )

    private fun machine(id: String, health: MachineHealth) =
        MachineState(id, if (id == "m-1") "MacBook" else "Studio", "macos", 0, health, null, null)

    /** The core's order: by state, then newest first within each. */
    private val rows = listOf(
        row("cc-ask", InboxState.NEEDS_YOU, 900),
        row("pi-run", InboxState.WORKING, 800, machine = "m-2"),
        row("cc-run", InboxState.WORKING, 700),
        row("pi-new", InboxState.DONE, 600),
        row("cc-old", InboxState.IDLE, 500),
        row("pi-older", InboxState.IDLE, 400, machine = "m-2"),
    )

    private val machines = listOf(
        machine("m-1", MachineHealth.Online(LinkRoute.LAN)),
        machine("m-2", MachineHealth.Waiting(WaitReason.MACHINE_OFFLINE)),
    )

    private fun state(
        rows: List<InboxRow> = this.rows,
        machines: List<MachineState> = this.machines,
        filter: InboxFilter = InboxFilter(),
        query: String = "",
        marks: SessionMarks = SessionMarks(),
    ) = inboxUiState(rows, machines, filter, query, refreshing = false, marks = marks)

    @Test
    fun rowsFallIntoSectionsInStateOrderKeepingTheCoresOrderWithinEach() {
        val state = state()
        assertEquals(
            listOf(InboxGroup.NEEDS_YOU, InboxGroup.WORKING, InboxGroup.DONE, InboxGroup.IDLE),
            state.sections.map { it.group },
        )
        assertEquals(listOf("pi-run", "cc-run"), state.sections[1].rows.map { it.session.sessionId })
        assertEquals(listOf("cc-old", "pi-older"), state.sections[3].rows.map { it.session.sessionId })
        assertEquals(rows, state.sections.flatMap { it.rows })
        assertFalse(state.onlyIdle)
    }

    @Test
    fun anEmptyStateHasNoSectionAndIdleAloneSaysSo() {
        val state = state(rows.filter { it.state != InboxState.WORKING })
        assertEquals(listOf(InboxGroup.NEEDS_YOU, InboxGroup.DONE, InboxGroup.IDLE), state.sections.map { it.group })
        assertTrue(state(emptyList()).isEmpty)
        assertTrue("Idle alone opens itself", state(rows.filter { it.state == InboxState.IDLE }).onlyIdle)
    }

    @Test
    fun theWorkingFilterShowsTheWorkingSectionAloneAndNothingOnceNothingWorks() {
        val working = InboxFilter(state = InboxState.WORKING)
        assertEquals(listOf(InboxGroup.WORKING), state(filter = working).sections.map { it.group })
        assertTrue(state(rows.filter { it.state != InboxState.WORKING }, filter = working).isEmpty)
    }

    @Test
    fun theAgentMacAndFolderFiltersNarrowEverySection() {
        assertEquals(listOf("cc-ask", "cc-run", "cc-old"), state(filter = InboxFilter(backend = BackendIds.CLAUDE_CODE)).sections.flatMap { s -> s.rows.map { it.session.sessionId } })
        assertEquals(listOf("pi-run", "pi-older"), state(filter = InboxFilter(machineId = "m-2")).sections.flatMap { s -> s.rows.map { it.session.sessionId } })
        assertTrue("a folder nothing ran in lists nothing", state(filter = InboxFilter(folder = "/elsewhere")).isEmpty)
        assertTrue(InboxFilter(folder = "/x").isActive)
        assertFalse(InboxFilter().isActive)
    }

    @Test
    fun theSearchMatchesEveryWordInTheTitleOrTheFolderIgnoringCase() {
        assertEquals(listOf("pi-older"), state(query = "SESSION older").sections.flatMap { s -> s.rows.map { it.session.sessionId } })
        assertEquals(rows.size, state(query = "broski").sections.sumOf { it.rows.size })
        assertTrue(state(query = "nothing like this").isEmpty)
    }

    @Test
    fun onlyMachinesThatAreNotFineAreMentionedAndEveryMachinesHealthIsKnown() {
        val paused = machine("m-3", MachineHealth.Waiting(WaitReason.PAUSED))
        val revoked = machine("m-4", MachineHealth.Revoked)
        val state = state(machines = machines + paused + revoked)
        assertEquals(listOf("m-2", "m-4"), state.mentions.map { it.id })
        assertEquals(MachineHealth.Waiting(WaitReason.MACHINE_OFFLINE), state.health["m-2"])
        assertTrue(state.anyOnline)
        assertFalse("an empty inbox of unreachable Macs is waiting, not empty", state(emptyList(), listOf(revoked)).anyOnline)
    }

    private fun pin(vararg ids: String) = SessionMarks(pinned = rows.filter { it.session.sessionId in ids }.map { SessionKey.of(it.machineId, it.session) }.toSet())

    @Test
    fun pinnedRowsComeRightBelowNeedsYouOnceEachAndAWaitingPinnedRowStaysInNeedsYou() {
        val state = state(marks = pin("cc-ask", "cc-run", "pi-older"))
        assertEquals(
            listOf(InboxGroup.NEEDS_YOU, InboxGroup.PINNED, InboxGroup.WORKING, InboxGroup.DONE, InboxGroup.IDLE),
            state.sections.map { it.group },
        )
        val ids = state.sections.associate { section -> section.group to section.rows.map { it.session.sessionId } }
        assertEquals(listOf("cc-ask"), ids[InboxGroup.NEEDS_YOU])
        assertEquals("in the core's order, whatever their state", listOf("cc-run", "pi-older"), ids[InboxGroup.PINNED])
        assertEquals(listOf("pi-run"), ids[InboxGroup.WORKING])
        assertEquals(listOf("cc-old"), ids[InboxGroup.IDLE])
        assertEquals("no row is listed twice", rows.size, state.sections.sumOf { it.rows.size })
        assertTrue(state.pinned(rows[2]))
    }

    @Test
    fun theWorkingFilterListsEveryWorkingRowPinnedOrNot() {
        val state = state(filter = InboxFilter(state = InboxState.WORKING), marks = pin("cc-run"))
        assertEquals(listOf(InboxGroup.WORKING), state.sections.map { it.group })
        assertEquals(listOf("pi-run", "cc-run"), state.sections.single().rows.map { it.session.sessionId })
    }

    @Test
    fun aRowOffersMarkUnreadOnceSeenMarkReadWhileDoneAndNeitherWhileItWaitsOrWorks() {
        val (ask, working, _, done, idle) = rows
        assertEquals(listOf(RowAction.Pin, RowAction.MarkUnread, RowAction.Mute), idle.actions(pinned = false, muted = false))
        assertEquals(listOf(RowAction.Unpin, RowAction.MarkRead, RowAction.Unmute), done.actions(pinned = true, muted = true))
        assertEquals(listOf(RowAction.Pin, RowAction.Mute), ask.actions(pinned = false, muted = false))
        assertEquals(listOf(RowAction.Unpin, RowAction.Mute), working.actions(pinned = true, muted = false))
    }
}
