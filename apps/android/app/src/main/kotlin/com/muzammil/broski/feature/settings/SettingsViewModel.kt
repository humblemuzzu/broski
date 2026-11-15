package com.muzammil.broski.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.core.settings.SettingsStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(val settings: AppSettings, val machines: List<MachineState>)

class SettingsViewModel(
    private val store: SettingsStore,
    settings: StateFlow<AppSettings?>,
    machines: StateFlow<List<MachineState>>,
) : ViewModel() {
    val state: StateFlow<SettingsUiState> = combine(settings, machines) { current, list ->
        SettingsUiState(current ?: AppSettings(), list)
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        SettingsUiState(settings.value ?: AppSettings(), machines.value),
    )

    fun setAppearance(appearance: Appearance) {
        viewModelScope.launch { store.setAppearance(appearance) }
    }

    fun setNotification(kind: NotificationKind, enabled: Boolean) {
        viewModelScope.launch { store.setNotification(kind, enabled) }
    }
}
