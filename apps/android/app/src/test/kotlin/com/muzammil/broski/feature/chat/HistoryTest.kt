package com.muzammil.broski.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uniffi.broski_contract.IdStability
import uniffi.broski_contract.TranscriptItem
import uniffi.broski_contract.TranscriptPage

/** The finished runs read page by page, newest first, and the newest page read again after a run. */
class HistoryTest {
    private fun page(vararg ids: String, next: String? = null, stability: IdStability = IdStability.STABLE) =
        TranscriptPage(ids.map { Items.user(it, it) }, next, stability)

    private val History.ids get() = items.map(TranscriptItem::id)

    @Test
    fun pagesArriveNewestFirstAndReadOldestFirst() {
        val first = History().withNewest(page("5", "4", "3", next = "c3"))
        assertEquals(listOf("3", "4", "5"), first.ids)
        val more = first.withOlder(page("2", "1"))
        assertEquals(listOf("1", "2", "3", "4", "5"), more.ids)
        assertNull(more.olderCursor)
    }

    @Test
    fun theNewestPageReadAgainReplacesWhatItOverlapsAndKeepsTheOlderPages() {
        val read = History().withNewest(page("4", "3", next = "c3")).withOlder(page("2", "1"))
        val again = read.withNewest(page("6", "5", "4", next = "c4"))
        assertEquals(listOf("1", "2", "3", "4", "5", "6"), again.ids)
    }

    @Test
    fun withoutAnOverlapOrStableIdsItStartsOverFromThatPage() {
        val read = History().withNewest(page("2", "1"))
        assertEquals(listOf("8", "9"), read.withNewest(page("9", "8", next = "c8")).ids)
        assertEquals("c8", read.withNewest(page("9", "8", next = "c8")).olderCursor)
        assertEquals(listOf("2", "3"), read.withNewest(page("3", "2", stability = IdStability.POSITIONAL)).ids)
    }

    @Test
    fun anOlderPageThatRepeatsARowShowsItOnce() {
        val read = History().withNewest(page("3", "2", next = "c")).withOlder(page("2", "1"))
        assertEquals(listOf("1", "2", "3"), read.ids)
    }
}
