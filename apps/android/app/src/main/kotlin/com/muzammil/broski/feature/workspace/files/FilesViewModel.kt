package com.muzammil.broski.feature.workspace.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_contract.FileEntry
import uniffi.broski_contract.FileMatch

data class FilesUiState(
    val entries: List<FileEntry> = emptyList(),
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val nextCursor: String? = null,
    val failure: WorkspaceFailure? = null,
    val showHidden: Boolean = false,
    val query: String = "",
    val matches: List<FileMatch>? = null,
    val searchFailure: WorkspaceFailure? = null,
)

/** One folder: its entries page by page as the bridge orders them (folders first), and a search by name under it. */
class FilesViewModel(private val client: WorkspaceClient, val path: String) : ViewModel() {
    private val mutableState = MutableStateFlow(FilesUiState())
    val state: StateFlow<FilesUiState> = mutableState.asStateFlow()
    private var listing: Job? = null
    private var searching: Job? = null

    init {
        reload()
    }

    fun reload() {
        listing?.cancel()
        mutableState.update { it.copy(loading = true, failure = null) }
        listing = viewModelScope.launch {
            when (val answer = client.list(path, cursor = null, hidden = state.value.showHidden)) {
                is Answer.Done -> mutableState.update {
                    it.copy(entries = answer.value.entries, nextCursor = answer.value.nextCursor, loading = false)
                }
                is Answer.Failed -> mutableState.update { it.copy(loading = false, failure = answer.failure) }
            }
        }
    }

    /** The next page, once the person nears the end of what is listed. */
    fun loadMore() {
        val current = state.value
        val cursor = current.nextCursor ?: return
        if (current.loading || current.loadingMore) return
        mutableState.update { it.copy(loadingMore = true) }
        listing = viewModelScope.launch {
            when (val answer = client.list(path, cursor, current.showHidden)) {
                is Answer.Done -> mutableState.update {
                    it.copy(entries = it.entries + answer.value.entries, nextCursor = answer.value.nextCursor, loadingMore = false)
                }
                is Answer.Failed -> mutableState.update { it.copy(loadingMore = false, failure = answer.failure) }
            }
        }
    }

    fun showHidden(show: Boolean) {
        if (show == state.value.showHidden) return
        mutableState.update { it.copy(showHidden = show) }
        reload()
    }

    /** Searches names under this folder once typing pauses; a blank query ends the search. */
    fun search(query: String) {
        searching?.cancel()
        mutableState.update { it.copy(query = query, searchFailure = null) }
        if (query.isBlank()) {
            mutableState.update { it.copy(matches = null) }
            return
        }
        searching = viewModelScope.launch {
            delay(SEARCH_PAUSE_MS)
            when (val answer = client.search(path, query.trim().take(MAX_QUERY_CHARS))) {
                is Answer.Done -> mutableState.update { it.copy(matches = answer.value.matches) }
                is Answer.Failed -> mutableState.update { it.copy(matches = emptyList(), searchFailure = answer.failure) }
            }
        }
    }

    private companion object {
        const val SEARCH_PAUSE_MS = 250L

        /** The contract's `MAX_SEARCH_QUERY_CHARS`. */
        const val MAX_QUERY_CHARS = 256
    }
}
