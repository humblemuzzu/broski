package com.muzammil.broski.feature.workspace.git

import com.muzammil.broski.feature.workspace.FakeBridge
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import com.muzammil.broski.feature.workspace.rejected
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import uniffi.broski_contract.ActionAccepted
import uniffi.broski_contract.ActionResult
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.GitBranch
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitCheckoutResponse
import uniffi.broski_contract.GitCheckoutResult
import uniffi.broski_contract.GitCommit
import uniffi.broski_contract.GitCommitResponse
import uniffi.broski_contract.GitCommitResult
import uniffi.broski_contract.GitCommitted
import uniffi.broski_contract.GitFileChange
import uniffi.broski_contract.GitLogRead
import uniffi.broski_contract.GitLogResponse
import uniffi.broski_contract.GitLogResult
import uniffi.broski_contract.GitStageResponse
import uniffi.broski_contract.GitStatusRead
import uniffi.broski_contract.GitStatusResponse
import uniffi.broski_contract.GitStatusResult
import uniffi.broski_contract.RejectionCode
import uniffi.broski_contract.ServerMessage

/** The repository screen's model against a bridge that keeps a little repository's state as git would report it. */
@OptIn(ExperimentalCoroutinesApi::class)
class GitViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private var staged = listOf<GitFileChange>()
    private var unstaged = listOf(GitFileChange("README.md", null, GitChange.MODIFIED, 2L, 1L))
    private var untracked = listOf("notes/todo.txt")
    private val commit = GitCommit("0e7307d1c2", "first commit", "Broski", 0L)

    private val bridge = FakeBridge { message ->
        when (message) {
            is ClientMessage.GitStatus -> ServerMessage.GitStatusResult(
                GitStatusResponse("1", GitStatusResult.Accepted(GitStatusRead("/repo", "main", "0e7307d", null, staged, unstaged, untracked, false))),
            )
            is ClientMessage.GitLog -> ServerMessage.GitLogResult(GitLogResponse("1", GitLogResult.Accepted(GitLogRead(listOf(commit)))))
            is ClientMessage.GitStage -> {
                staged = staged + unstaged.filter { it.path in message.v1.paths }
                unstaged = unstaged.filterNot { it.path in message.v1.paths }
                ServerMessage.GitStageResult(GitStageResponse("1", ActionResult.Accepted(ActionAccepted())))
            }
            is ClientMessage.GitCommit -> ServerMessage.GitCommitResult(
                GitCommitResponse("1", GitCommitResult.Accepted(GitCommitted(commit.copy(subject = message.v1.message)))),
            )
            is ClientMessage.GitCheckout -> ServerMessage.GitCheckoutResult(
                GitCheckoutResponse(
                    "1",
                    GitCheckoutResult.Rejected(
                        rejected(RejectionCode.INVALID_INPUT, "error: Your local changes to the following files would be overwritten by checkout:\n\tREADME.md"),
                    ),
                ),
            )
            else -> error("unexpected $message")
        }
    }

    @Before
    fun setUp() = Dispatchers.setMain(dispatcher)

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun theStatusBecomesTheScreensListsInGitsOrder() = runTest(dispatcher) {
        val git = GitViewModel(WorkspaceClient(bridge), "/repo/src")
        advanceUntilIdle()
        val sections = git.state.value.sections
        assertEquals(listOf(Area.Unstaged, Area.Untracked), sections.map { it.area })
        val readme = sections[0].rows.single()
        assertEquals(Triple("M", 2L, 1L), Triple(readme.letter, readme.additions, readme.deletions))
        val todo = sections[1].rows.single()
        assertEquals(Triple("todo.txt", "notes", "?"), Triple(todo.name, todo.folder, todo.letter))
        assertEquals(listOf("first commit"), git.state.value.log.map { it.subject })
    }

    @Test
    fun stagingSendsThePathsAndReadsTheStatusAgain() = runTest(dispatcher) {
        val git = GitViewModel(WorkspaceClient(bridge), "/repo/src")
        advanceUntilIdle()
        git.stage(listOf("README.md"))
        advanceUntilIdle()
        assertEquals(listOf("README.md"), bridge.requests.filterIsInstance<ClientMessage.GitStage>().single().v1.paths)
        assertEquals(listOf(Area.Staged, Area.Untracked), git.state.value.sections.map { it.area })
        assertFalse(git.state.value.busy)
    }

    @Test
    fun aCommitNeedsStagedChangesAndAMessageAndClearsTheMessage() = runTest(dispatcher) {
        val git = GitViewModel(WorkspaceClient(bridge), "/repo/src")
        advanceUntilIdle()
        git.editMessage("Edit the readme")
        assertFalse("nothing is staged", git.state.value.canCommit)
        git.stage(listOf("README.md"))
        advanceUntilIdle()
        assertTrue(git.state.value.canCommit)
        git.commit()
        advanceUntilIdle()
        assertEquals(GitEvent.Committed(commit.copy(subject = "Edit the readme")), git.events.first())
        assertEquals("", git.state.value.message)
    }

    @Test
    fun aRefusedCheckoutComesBackInGitsOwnWords() = runTest(dispatcher) {
        val git = GitViewModel(WorkspaceClient(bridge), "/repo/src")
        advanceUntilIdle()
        git.checkout(GitBranch("origin/feature", remote = true, current = false, upstream = null))
        advanceUntilIdle()
        assertEquals("feature", bridge.requests.filterIsInstance<ClientMessage.GitCheckout>().single().v1.branch)
        val failure = (git.events.first() as GitEvent.Failed).failure
        assertEquals(WorkspaceFailure.Reason.Refused, failure.reason)
        assertTrue(failure.detail!!.startsWith("error: Your local changes"))
    }
}
