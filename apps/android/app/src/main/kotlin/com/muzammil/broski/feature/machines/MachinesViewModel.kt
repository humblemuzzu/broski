package com.muzammil.broski.feature.machines

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.PhoneSession
import java.io.IOException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import uniffi.broski_core.ClientException

data class MachinesUiState(val machines: List<MachineState>, val unreadable: List<String>)

class MachinesViewModel(private val phone: PhoneSession) : ViewModel() {
    val state: StateFlow<MachinesUiState> = combine(phone.machines, phone.unreadableMachines) { machines, unreadable ->
        MachinesUiState(machines, unreadable.sorted())
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        MachinesUiState(phone.machines.value, phone.unreadableMachines.value.sorted()),
    )

    private val restartFailures = Channel<String>(Channel.BUFFERED)

    /** The id of each machine whose bridge restart the link would not send. */
    val restartFailed: Flow<String> = restartFailures.receiveAsFlow()

    fun forget(id: String) {
        viewModelScope.launch {
            try {
                phone.forget(id)
            } catch (error: IOException) {
                Log.e(TAG, "the forgotten machine's record could not be deleted", error)
            }
        }
    }

    fun restartBridge(id: String) {
        try {
            phone.restartBridge(id)
        } catch (_: ClientException) {
            restartFailures.trySend(id)
        }
    }

    private companion object {
        const val TAG = "Machines"
    }
}
