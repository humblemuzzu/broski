package com.muzammil.broski.feature.workspace.git

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import uniffi.broski_contract.GitDiffRead

sealed interface DiffUiState {
    data object Loading : DiffUiState

    data class Shown(val diff: GitDiffRead) : DiffUiState

    data class Failed(val failure: WorkspaceFailure) : DiffUiState
}

class DiffViewModel(private val client: WorkspaceClient, val cwd: String, val path: String, val staged: Boolean) : ViewModel() {
    private val mutableState = MutableStateFlow<DiffUiState>(DiffUiState.Loading)
    val state: StateFlow<DiffUiState> = mutableState.asStateFlow()

    init {
        reload()
    }

    fun reload() {
        mutableState.value = DiffUiState.Loading
        viewModelScope.launch {
            mutableState.value = when (val answer = client.diff(cwd, path, staged)) {
                is Answer.Done -> DiffUiState.Shown(answer.value)
                is Answer.Failed -> DiffUiState.Failed(answer.failure)
            }
        }
    }
}
