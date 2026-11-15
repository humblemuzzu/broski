package com.muzammil.broski.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.PhoneSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class InboxViewModel(private val phone: PhoneSession) : ViewModel() {
    private val workingOnly = MutableStateFlow(false)
    private val refreshing = MutableStateFlow(false)

    val state: StateFlow<InboxUiState> = combine(phone.inboxRows, phone.machines, workingOnly, refreshing, ::inboxUiState)
        .stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            inboxUiState(phone.inboxRows.value, phone.machines.value, workingOnly = false, refreshing = false),
        )

    fun showWorkingOnly(only: Boolean) {
        workingOnly.value = only
    }

    fun refresh() {
        if (refreshing.value) return
        refreshing.value = true
        viewModelScope.launch {
            try {
                phone.refresh()
            } finally {
                refreshing.value = false
            }
        }
    }
}
