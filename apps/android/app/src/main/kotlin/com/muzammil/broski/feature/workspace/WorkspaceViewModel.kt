package com.muzammil.broski.feature.workspace

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.GitStatusRead
import uniffi.broski_contract.TerminalSummary
import uniffi.broski_contract.WorkspaceInfo

/** A repository found among the folders the person works in, with what its status says at a glance. */
data class Repository(val root: String, val branch: String?, val head: String?, val changes: Int)

data class WorkspaceUiState(
    val info: WorkspaceInfo? = null,
    val infoFailure: WorkspaceFailure? = null,
    val terminals: List<TerminalSummary>? = null,
    val terminalsFailure: WorkspaceFailure? = null,
    val repositories: List<Repository>? = null,
) {
    /** The folders to start from: the served roots, then folders sessions ran in that are not one of them. */
    fun folders(recent: List<String>): Pair<List<String>, List<String>> {
        val roots = info?.roots.orEmpty()
        return roots to recent.filter { it !in roots }
    }
}

/**
 * A machine's workspace at the top: what it serves, its terminals, and which of the person's
 * folders are git repositories (found by asking `git.status` of each, as the contract has no list).
 */
class WorkspaceViewModel(private val client: WorkspaceClient, private val recentFolders: List<String>) : ViewModel() {
    private val mutableState = MutableStateFlow(WorkspaceUiState())
    val state: StateFlow<WorkspaceUiState> = mutableState.asStateFlow()

    init {
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            when (val answer = client.info()) {
                is Answer.Done -> {
                    mutableState.update { it.copy(info = answer.value, infoFailure = null) }
                    if (answer.value.terminal) launch { readTerminals() }
                    if (answer.value.git) launch { findRepositories(answer.value.roots) }
                }
                is Answer.Failed -> mutableState.update { it.copy(infoFailure = answer.failure) }
            }
        }
    }

    fun refreshTerminals() {
        viewModelScope.launch { readTerminals() }
    }

    /** Ends the terminal's program on the Mac if it still runs, and forgets it. */
    fun closeTerminal(id: String) {
        viewModelScope.launch {
            when (val answer = client.closeTerminal(id)) {
                is Answer.Done -> readTerminals()
                is Answer.Failed -> mutableState.update { it.copy(terminalsFailure = answer.failure) }
            }
        }
    }

    private suspend fun readTerminals() {
        when (val answer = client.terminals()) {
            is Answer.Done -> mutableState.update { it.copy(terminals = answer.value, terminalsFailure = null) }
            is Answer.Failed -> mutableState.update { it.copy(terminalsFailure = answer.failure) }
        }
    }

    private suspend fun findRepositories(roots: List<String>) {
        val candidates = (roots + recentFolders).distinct().take(MAX_PROBES)
        val found = coroutineScope {
            candidates.map { folder -> async { (client.status(folder) as? Answer.Done)?.value } }.awaitAll()
        }
        mutableState.update { it.copy(repositories = repositories(found.filterNotNull())) }
    }

    private companion object {
        /** Each probe is a git process on the Mac; a phone's list of folders needs no more. */
        const val MAX_PROBES = 12
    }
}

/** One entry per repository, however many of the folders lie in it, by name. */
fun repositories(statuses: List<GitStatusRead>): List<Repository> = statuses
    .distinctBy { it.root }
    .map { Repository(it.root, it.branch, it.head, it.staged.size + it.unstaged.size + it.untracked.size) }
    .sortedBy { lastComponent(it.root).lowercase() }
