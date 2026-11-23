package com.muzammil.broski.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.InboxFilter
import com.muzammil.broski.core.InboxFilters
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.SessionMark
import com.muzammil.broski.core.sessionKey
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
import uniffi.broski_core.InboxState

class InboxViewModel(private val phone: PhoneSession, private val filters: InboxFilters) : ViewModel() {
    private val query = MutableStateFlow("")
    private val refreshing = MutableStateFlow(false)
    private val answering = MutableStateFlow<Set<String>>(emptySet())
    private val answerEvents = MutableSharedFlow<RowAnswer>(extraBufferCapacity = 8)

    private val marks = combine(phone.pinned, phone.muted, ::SessionMarks)
    private val view = combine(filters.filter, query, refreshing, ::Triple)

    val state: StateFlow<InboxUiState> =
        combine(phone.inboxRows, phone.machines, view, combine(answering, marks, ::Pair)) {
                rows, machines, (filter, searched, pulling), (sending, marked) ->
            inboxUiState(rows, machines, filter, searched, pulling, sending, marked)
        }.stateIn(
            viewModelScope,
            SharingStarted.WhileSubscribed(5_000),
            inboxUiState(
                phone.inboxRows.value,
                phone.machines.value,
                filters.filter.value,
                query = "",
                refreshing = false,
                marks = SessionMarks(phone.pinned.value, phone.muted.value),
            ),
        )

    /** Each answer given from a row, once, for its haptic and what the screen says of it. */
    val answers: SharedFlow<RowAnswer> = answerEvents.asSharedFlow()

    init {
        // The working focus ends with the last working session, as it does on iOS.
        viewModelScope.launch {
            combine(phone.inboxRows, filters.filter, ::Pair).collect { (rows, filter) ->
                if (filter.state == InboxState.WORKING && rows.none { it.state == InboxState.WORKING }) {
                    filters.update { it.copy(state = null) }
                }
            }
        }
    }

    fun search(text: String) {
        query.value = text
    }

    fun setFilter(filter: InboxFilter) = filters.set(filter)

    fun markAllSeen() {
        phone.markAllSeen()
    }

    fun act(row: InboxRow, action: RowAction) {
        when (action) {
            RowAction.Pin, RowAction.Unpin -> phone.setMarked(SessionMark.Pinned, row.sessionKey, action == RowAction.Pin)
            RowAction.Mute, RowAction.Unmute -> phone.setMarked(SessionMark.Muted, row.sessionKey, action == RowAction.Mute)
            RowAction.MarkUnread -> phone.markUnread(row.machineId, row.session)
            RowAction.MarkRead -> phone.markSeen(row.machineId, row.session)
        }
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
