package com.muzammil.broski.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.KeepScreenAwake
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.core.settings.ReadingSettings
import com.muzammil.broski.core.settings.SettingsStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(val settings: AppSettings)

class SettingsViewModel(private val store: SettingsStore, settings: StateFlow<AppSettings?>) : ViewModel() {
    val state: StateFlow<SettingsUiState> = settings.map { SettingsUiState(it ?: AppSettings()) }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        SettingsUiState(settings.value ?: AppSettings()),
    )

    fun setAppearance(appearance: Appearance) {
        viewModelScope.launch { store.setAppearance(appearance) }
    }

    fun setDynamicColor(enabled: Boolean) {
        viewModelScope.launch { store.setDynamicColor(enabled) }
    }

    fun setKeepScreenAwake(mode: KeepScreenAwake) {
        viewModelScope.launch { store.setKeepScreenAwake(mode) }
    }

    fun setNotification(kind: NotificationKind, enabled: Boolean) {
        viewModelScope.launch { store.setNotification(kind, enabled) }
    }

    fun setCollapsesWork(enabled: Boolean) {
        viewModelScope.launch { store.setCollapsesWork(enabled) }
    }

    fun setReading(reading: ReadingSettings) {
        viewModelScope.launch { store.setReading(reading) }
    }
}
