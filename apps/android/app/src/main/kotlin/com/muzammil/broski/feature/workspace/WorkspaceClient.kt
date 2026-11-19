package com.muzammil.broski.feature.workspace

import uniffi.broski_contract.ActionResult
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.FileImageRead
import uniffi.broski_contract.FileRead
import uniffi.broski_contract.FilesFound
import uniffi.broski_contract.FilesListed
import uniffi.broski_contract.FsImageRequest
import uniffi.broski_contract.FsImageResult
import uniffi.broski_contract.FsListRequest
import uniffi.broski_contract.FsListResult
import uniffi.broski_contract.FsReadRequest
import uniffi.broski_contract.FsReadResult
import uniffi.broski_contract.FsSearchRequest
import uniffi.broski_contract.FsSearchResult
import uniffi.broski_contract.ImageVariant
import uniffi.broski_contract.GitBranchesListed
import uniffi.broski_contract.GitBranchesRequest
import uniffi.broski_contract.GitBranchesResult
import uniffi.broski_contract.GitCheckedOut
import uniffi.broski_contract.GitCheckoutRequest
import uniffi.broski_contract.GitCheckoutResult
import uniffi.broski_contract.GitCommitRequest
import uniffi.broski_contract.GitCommitResult
import uniffi.broski_contract.GitCommitted
import uniffi.broski_contract.GitDiffRead
import uniffi.broski_contract.GitDiffRequest
import uniffi.broski_contract.GitDiffResult
import uniffi.broski_contract.GitLogRead
import uniffi.broski_contract.GitLogRequest
import uniffi.broski_contract.GitLogResult
import uniffi.broski_contract.GitStageRequest
import uniffi.broski_contract.GitStatusRead
import uniffi.broski_contract.GitStatusRequest
import uniffi.broski_contract.GitStatusResult
import uniffi.broski_contract.GitUnstageRequest
import uniffi.broski_contract.ServerMessage
import uniffi.broski_contract.TermCloseRequest
import uniffi.broski_contract.TermListRequest
import uniffi.broski_contract.TermListResult
import uniffi.broski_contract.TermOpenRequest
import uniffi.broski_contract.TermOpenResult
import uniffi.broski_contract.TerminalSummary
import uniffi.broski_contract.WorkspaceInfo
import uniffi.broski_contract.WorkspaceInfoRequest
import uniffi.broski_contract.WorkspaceInfoResult
import uniffi.broski_core.ClientException

/** One contract request to a machine and its answer: `Machine::request`, or a test's bridge. */
fun interface Requester {
    suspend fun request(message: ClientMessage): ServerMessage
}

sealed interface Answer<out T> {
    data class Done<T>(val value: T) : Answer<T>

    data class Failed(val failure: WorkspaceFailure) : Answer<Nothing>
}

/**
 * The workspace requests of contract README §20, each answered with its accepted value or why not.
 * The core mints request ids, so every request is built with an empty one.
 */
class WorkspaceClient(private val requester: Requester) {
    suspend fun info(): Answer<WorkspaceInfo> = ask(ClientMessage.WorkspaceInfo(WorkspaceInfoRequest(""))) {
        when (val result = (it as? ServerMessage.WorkspaceInfoResult)?.v1?.result) {
            is WorkspaceInfoResult.Accepted -> Answer.Done(result.v1)
            is WorkspaceInfoResult.Rejected -> failed(result.v1)
            null -> null
        }
    }

    suspend fun list(path: String, cursor: String?, hidden: Boolean): Answer<FilesListed> =
        ask(ClientMessage.FsList(FsListRequest("", path, cursor, limit = null, hidden = hidden))) {
            when (val result = (it as? ServerMessage.FsListResult)?.v1?.result) {
                is FsListResult.Accepted -> Answer.Done(result.v1)
                is FsListResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun read(path: String): Answer<FileRead> =
        ask(ClientMessage.FsRead(FsReadRequest("", path, offset = null, length = null))) {
            when (val result = (it as? ServerMessage.FsReadResult)?.v1?.result) {
                is FsReadResult.Accepted -> Answer.Done(result.v1)
                is FsReadResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun image(path: String, variant: ImageVariant = ImageVariant.FULL): Answer<FileImageRead> =
        ask(ClientMessage.FsImage(FsImageRequest("", path, variant))) {
            when (val result = (it as? ServerMessage.FsImageResult)?.v1?.result) {
                is FsImageResult.Accepted -> Answer.Done(result.v1)
                is FsImageResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun search(root: String, query: String): Answer<FilesFound> =
        ask(ClientMessage.FsSearch(FsSearchRequest("", root, query, limit = null))) {
            when (val result = (it as? ServerMessage.FsSearchResult)?.v1?.result) {
                is FsSearchResult.Accepted -> Answer.Done(result.v1)
                is FsSearchResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun status(cwd: String): Answer<GitStatusRead> = ask(ClientMessage.GitStatus(GitStatusRequest("", cwd))) {
        when (val result = (it as? ServerMessage.GitStatusResult)?.v1?.result) {
            is GitStatusResult.Accepted -> Answer.Done(result.v1)
            is GitStatusResult.Rejected -> failed(result.v1)
            null -> null
        }
    }

    suspend fun diff(cwd: String, path: String, staged: Boolean): Answer<GitDiffRead> =
        ask(ClientMessage.GitDiff(GitDiffRequest("", cwd, path, staged))) {
            when (val result = (it as? ServerMessage.GitDiffResult)?.v1?.result) {
                is GitDiffResult.Accepted -> Answer.Done(result.v1)
                is GitDiffResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun stage(cwd: String, paths: List<String>): Answer<Unit> =
        ask(ClientMessage.GitStage(GitStageRequest("", cwd, paths))) { action((it as? ServerMessage.GitStageResult)?.v1?.result) }

    suspend fun unstage(cwd: String, paths: List<String>): Answer<Unit> =
        ask(ClientMessage.GitUnstage(GitUnstageRequest("", cwd, paths))) { action((it as? ServerMessage.GitUnstageResult)?.v1?.result) }

    suspend fun commit(cwd: String, message: String): Answer<GitCommitted> =
        ask(ClientMessage.GitCommit(GitCommitRequest("", cwd, message))) {
            when (val result = (it as? ServerMessage.GitCommitResult)?.v1?.result) {
                is GitCommitResult.Accepted -> Answer.Done(result.v1)
                is GitCommitResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun branches(cwd: String): Answer<GitBranchesListed> = ask(ClientMessage.GitBranches(GitBranchesRequest("", cwd))) {
        when (val result = (it as? ServerMessage.GitBranchesResult)?.v1?.result) {
            is GitBranchesResult.Accepted -> Answer.Done(result.v1)
            is GitBranchesResult.Rejected -> failed(result.v1)
            null -> null
        }
    }

    suspend fun checkout(cwd: String, branch: String): Answer<GitCheckedOut> =
        ask(ClientMessage.GitCheckout(GitCheckoutRequest("", cwd, branch))) {
            when (val result = (it as? ServerMessage.GitCheckoutResult)?.v1?.result) {
                is GitCheckoutResult.Accepted -> Answer.Done(result.v1)
                is GitCheckoutResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun log(cwd: String, limit: Long): Answer<GitLogRead> = ask(ClientMessage.GitLog(GitLogRequest("", cwd, limit))) {
        when (val result = (it as? ServerMessage.GitLogResult)?.v1?.result) {
            is GitLogResult.Accepted -> Answer.Done(result.v1)
            is GitLogResult.Rejected -> failed(result.v1)
            null -> null
        }
    }

    suspend fun terminals(): Answer<List<TerminalSummary>> = ask(ClientMessage.TermList(TermListRequest(""))) {
        when (val result = (it as? ServerMessage.TermListResult)?.v1?.result) {
            is TermListResult.Accepted -> Answer.Done(result.v1.terminals)
            is TermListResult.Rejected -> failed(result.v1)
            null -> null
        }
    }

    suspend fun openTerminal(cwd: String, cols: Long, rows: Long): Answer<TerminalSummary> =
        ask(ClientMessage.TermOpen(TermOpenRequest("", cwd, cols, rows, cellWidth = null, cellHeight = null))) {
            when (val result = (it as? ServerMessage.TermOpenResult)?.v1?.result) {
                is TermOpenResult.Accepted -> Answer.Done(result.v1.terminal)
                is TermOpenResult.Rejected -> failed(result.v1)
                null -> null
            }
        }

    suspend fun closeTerminal(id: String): Answer<Unit> =
        ask(ClientMessage.TermClose(TermCloseRequest("", id))) { action((it as? ServerMessage.TermCloseResult)?.v1?.result) }

    private fun failed(rejected: uniffi.broski_contract.Rejected) = Answer.Failed(WorkspaceFailure.of(rejected.rejection))

    private fun action(result: ActionResult?): Answer<Unit>? = when (result) {
        is ActionResult.Accepted -> Answer.Done(Unit)
        is ActionResult.Rejected -> failed(result.v1)
        null -> null
    }

    private suspend fun <T> ask(message: ClientMessage, read: (ServerMessage) -> Answer<T>?): Answer<T> = try {
        read(requester.request(message)) ?: Answer.Failed(WorkspaceFailure.Unexpected)
    } catch (error: ClientException) {
        Answer.Failed(WorkspaceFailure.of(error))
    }
}
