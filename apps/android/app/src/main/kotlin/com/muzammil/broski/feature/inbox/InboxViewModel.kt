package com.muzammil.broski.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.PhoneSession
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.broski_core.ClientException
import uniffi.broski_core.InboxRow

class InboxViewModel(private val phone: PhoneSession) : ViewModel() {
    private val workingOnly = MutableStateFlow(false)
    private val refreshing = MutableStateFlow(false)
    private val answering = MutableStateFlow<Set<String>>(emptySet())
    private val answerEvents = MutableSharedFlow<RowAnswer>(extraBufferCapacity = 8)

    val state: StateFlow<InboxUiState> =
        combine(phone.inboxRows, phone.machines, workingOnly, refreshing, answering, ::inboxUiState)
            .stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(5_000),
                inboxUiState(phone.inboxRows.value, phone.machines.value, workingOnly = false, refreshing = false),
            )

    /** Each answer given from a row, once, for its haptic and what the screen says of it. */
    val answers: SharedFlow<RowAnswer> = answerEvents.asSharedFlow()

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

    /** The person tapped Approve or Deny: sends the row's own option for it, once at a time. */
    fun answer(row: InboxRow, decision: Decision) {
        val option = row.quickOption(decision) ?: return
        val key = row.key
        if (key in answering.getAndUpdate { it + key }) return
        viewModelScope.launch {
            val answer = try {
                RowAnswer.of(decision, phone.answer(row, option))
            } catch (error: ClientException) {
                RowAnswer(decision, RowAnswer.Result.Failed(error.message ?: error.toString()))
            } finally {
                answering.update { it - key }
            }
            answerEvents.emit(answer)
        }
    }
}
