package com.muzammil.broski.feature.workspace.git

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.GitBranch
import uniffi.broski_contract.GitCommit
import uniffi.broski_contract.GitStatusRead

data class GitUiState(
    val status: GitStatusRead? = null,
    val sections: List<ChangeSection> = emptyList(),
    val log: List<GitCommit> = emptyList(),
    val loading: Boolean = true,
    val failure: WorkspaceFailure? = null,
    /** A stage, unstage, commit or checkout is on its way; another waits for it. */
    val busy: Boolean = false,
    /** Pulled to refresh, and reading. */
    val refreshing: Boolean = false,
    val message: String = "",
    val branches: List<GitBranch>? = null,
    val branchesFailure: WorkspaceFailure? = null,
) {
    val canCommit: Boolean get() = !busy && message.isNotBlank() && status?.staged?.isNotEmpty() == true
}

sealed interface GitEvent {
    data class Committed(val commit: GitCommit) : GitEvent

    data class CheckedOut(val branch: String) : GitEvent

    data class Failed(val failure: WorkspaceFailure) : GitEvent
}

/** One repository: its status and recent commits, read again after every change made from here. */
class GitViewModel(private val client: WorkspaceClient, val cwd: String) : ViewModel() {
    private val mutableState = MutableStateFlow(GitUiState())
    val state: StateFlow<GitUiState> = mutableState.asStateFlow()
    private val outcomes = Channel<GitEvent>(Channel.BUFFERED)
    val events: Flow<GitEvent> = outcomes.receiveAsFlow()

    init {
        viewModelScope.launch { read() }
    }

    fun refresh() {
        mutableState.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            read()
            mutableState.update { it.copy(refreshing = false) }
        }
    }

    fun editMessage(message: String) = mutableState.update { it.copy(message = message) }

    fun stage(paths: List<String>) = mutate { client.stage(cwd, paths).failure() }

    fun unstage(paths: List<String>) = mutate { client.unstage(cwd, paths).failure() }

    fun commit() {
        val message = state.value.message.trim()
        if (!state.value.canCommit) return
        mutate {
            when (val answer = client.commit(cwd, message)) {
                is Answer.Done -> {
                    mutableState.update { it.copy(message = "") }
                    outcomes.send(GitEvent.Committed(answer.value.commit))
                    null
                }
                is Answer.Failed -> answer.failure
            }
        }
    }

    fun loadBranches() {
        mutableState.update { it.copy(branches = null, branchesFailure = null) }
        viewModelScope.launch {
            when (val answer = client.branches(cwd)) {
                is Answer.Done -> mutableState.update { it.copy(branches = answer.value.branches) }
                is Answer.Failed -> mutableState.update { it.copy(branches = emptyList(), branchesFailure = answer.failure) }
            }
        }
    }

    /** Git refuses a switch that would overwrite local changes; its words come back as the failure. */
    fun checkout(branch: GitBranch) = mutate {
        when (val answer = client.checkout(cwd, checkoutName(branch))) {
            is Answer.Done -> {
                outcomes.send(GitEvent.CheckedOut(answer.value.branch))
                null
            }
            is Answer.Failed -> answer.failure
        }
    }

    private fun mutate(action: suspend () -> WorkspaceFailure?) {
        if (state.value.busy) return
        mutableState.update { it.copy(busy = true) }
        viewModelScope.launch {
            action()?.let { outcomes.send(GitEvent.Failed(it)) }
            read()
            mutableState.update { it.copy(busy = false) }
        }
    }

    private suspend fun read() {
        mutableState.update { it.copy(loading = it.status == null, failure = null) }
        val log = viewModelScope.async { client.log(cwd, LOG_LIMIT) }
        when (val status = client.status(cwd)) {
            is Answer.Done -> mutableState.update {
                it.copy(status = status.value, sections = changeSections(status.value), loading = false)
            }
            is Answer.Failed -> mutableState.update { it.copy(loading = false, failure = status.failure) }
        }
        (log.await() as? Answer.Done)?.let { answer -> mutableState.update { it.copy(log = answer.value.commits) } }
    }

    private fun Answer<Unit>.failure(): WorkspaceFailure? = (this as? Answer.Failed)?.failure

    private companion object {
        const val LOG_LIMIT = 20L
    }
}
