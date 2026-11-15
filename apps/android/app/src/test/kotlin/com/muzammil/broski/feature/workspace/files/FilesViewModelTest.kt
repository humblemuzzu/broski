package com.muzammil.broski.feature.workspace.files

import com.muzammil.broski.feature.workspace.FakeBridge
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import com.muzammil.broski.feature.workspace.rejected
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.FileEntry
import uniffi.broski_contract.FileKind
import uniffi.broski_contract.FileMatch
import uniffi.broski_contract.FilesFound
import uniffi.broski_contract.FilesListed
import uniffi.broski_contract.FsListResponse
import uniffi.broski_contract.FsListResult
import uniffi.broski_contract.FsSearchResponse
import uniffi.broski_contract.FsSearchResult
import uniffi.broski_contract.RejectionCode
import uniffi.broski_contract.ServerMessage

@OptIn(ExperimentalCoroutinesApi::class)
class FilesViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun entry(name: String, kind: FileKind = FileKind.FILE) = FileEntry(name, kind, 1L, 0L)

    /** A folder of 450 files, served 200 at a time with the cursor the contract describes. */
    private val pages = FakeBridge { message ->
        val request = (message as ClientMessage.FsList).v1
        val start = request.cursor?.toInt() ?: 0
        val end = minOf(start + 200, 450)
        val listed = FilesListed(request.path, (start until end).map { entry("file$it") }, if (end < 450) end.toString() else null)
        ServerMessage.FsListResult(FsListResponse("1", FsListResult.Accepted(listed)))
    }

    @Test
    fun pagesFollowTheCursorUntilTheFolderEnds() = runTest(dispatcher) {
        val files = FilesViewModel(WorkspaceClient(pages), "/repo")
        advanceUntilIdle()
        assertEquals(200, files.state.value.entries.size)
        files.loadMore()
        advanceUntilIdle()
        files.loadMore()
        advanceUntilIdle()
        val state = files.state.value
        assertEquals((0 until 450).map { "file$it" }, state.entries.map { it.name })
        assertNull(state.nextCursor)
        files.loadMore()
        advanceUntilIdle()
        assertEquals(listOf(null, "200", "400"), pages.requests.map { (it as ClientMessage.FsList).v1.cursor })
    }

    @Test
    fun hiddenFilesAreAskedForAndTheListingStartsOver() = runTest(dispatcher) {
        val files = FilesViewModel(WorkspaceClient(pages), "/repo")
        advanceUntilIdle()
        files.loadMore()
        advanceUntilIdle()
        files.showHidden(true)
        advanceUntilIdle()
        val last = (pages.requests.last() as ClientMessage.FsList).v1
        assertEquals(true, last.hidden)
        assertNull(last.cursor)
        assertEquals(200, files.state.value.entries.size)
    }

    @Test
    fun aFolderOutsideTheServedOnesSaysSo() = runTest(dispatcher) {
        val bridge = FakeBridge {
            ServerMessage.FsListResult(FsListResponse("1", FsListResult.Rejected(rejected(RejectionCode.FORBIDDEN, "outside the roots"))))
        }
        val files = FilesViewModel(WorkspaceClient(bridge), "/etc")
        advanceUntilIdle()
        assertEquals(WorkspaceFailure(WorkspaceFailure.Reason.Forbidden, "outside the roots"), files.state.value.failure)
    }

    @Test
    fun searchWaitsForTypingToPauseAndAsksOnce() = runTest(dispatcher) {
        val bridge = FakeBridge { message ->
            when (message) {
                is ClientMessage.FsList -> pages.request(message)
                is ClientMessage.FsSearch -> ServerMessage.FsSearchResult(
                    FsSearchResponse("1", FsSearchResult.Accepted(FilesFound(message.v1.root, listOf(FileMatch("src/main.rs", FileKind.FILE))))),
                )
                else -> error("unexpected $message")
            }
        }
        val files = FilesViewModel(WorkspaceClient(bridge), "/repo")
        advanceUntilIdle()
        files.search("m")
        advanceTimeBy(100)
        files.search("ma")
        advanceTimeBy(100)
        files.search("main")
        advanceUntilIdle()
        val searches = bridge.requests.filterIsInstance<ClientMessage.FsSearch>()
        assertEquals(listOf("main"), searches.map { it.v1.query })
        assertEquals(listOf("src/main.rs"), files.state.value.matches?.map { it.path })
        files.search("  ")
        assertNull(files.state.value.matches)
    }
}
