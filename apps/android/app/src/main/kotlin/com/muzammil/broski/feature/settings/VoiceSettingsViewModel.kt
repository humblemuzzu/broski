package com.muzammil.broski.feature.settings

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.SettingsStore
import com.muzammil.broski.core.settings.VoiceSettings
import com.muzammil.broski.core.voice.Dictation
import com.muzammil.broski.core.voice.DictationProblem
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What checking or saving the key last said. */
sealed interface KeyStatus {
    data object None : KeyStatus

    data object Checking : KeyStatus

    data class Said(@param:StringRes val message: Int) : KeyStatus

    data class Failed(val problem: DictationProblem) : KeyStatus
}

data class VoiceUiState(val voice: VoiceSettings, val key: String?, val status: KeyStatus)

/** Settings › Voice: the key goes through [Dictation], which checks it with xAI first; the rest is local preferences. */
class VoiceSettingsViewModel(private val store: SettingsStore, settings: StateFlow<AppSettings?>, private val dictation: Dictation) : ViewModel() {
    private val status = MutableStateFlow<KeyStatus>(KeyStatus.None)

    val state: StateFlow<VoiceUiState> = combine(settings, dictation.key, status) { current, key, said ->
        VoiceUiState(current?.voice ?: VoiceSettings(), key, said)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), VoiceUiState(settings.value?.voice ?: VoiceSettings(), dictation.key.value, KeyStatus.None))

    /** Saves [entry] once xAI took it, or when xAI could not be reached to say, then calls [saved]. */
    fun saveKey(entry: String, saved: () -> Unit) {
        if (entry.isBlank() || status.value == KeyStatus.Checking) return
        status.value = KeyStatus.Checking
        viewModelScope.launch {
            status.value = when (val outcome = dictation.saveKey(entry)) {
                Dictation.KeyOutcome.Checked -> KeyStatus.Said(R.string.voice_key_checked).also { saved() }
                is Dictation.KeyOutcome.Unchecked -> KeyStatus.Said(R.string.voice_key_unchecked).also { saved() }
                is Dictation.KeyOutcome.Refused -> KeyStatus.Failed(outcome.problem)
            }
        }
    }

    fun removeKey() {
        viewModelScope.launch {
            status.value = try {
                dictation.removeKey()
                KeyStatus.None
            } catch (error: IOException) {
                KeyStatus.Failed(DictationProblem(R.string.voice_key_not_removed, error.message, DictationProblem.Fix.None))
            }
        }
    }

    fun setLanguage(code: String?) = launch { store.setVoiceLanguage(code) }

    fun setSendAfter(enabled: Boolean) = launch { store.setSendAfterDictating(enabled) }

    fun setProjectWords(enabled: Boolean) = launch { store.setProjectWords(enabled) }

    fun addWord(word: String) {
        val trimmed = word.trim()
        val words = state.value.voice.dictionary
        if (trimmed.isEmpty() || trimmed.length > MAX_WORD || words.any { it.equals(trimmed, ignoreCase = true) }) return
        launch { store.setDictionary(words + trimmed) }
    }

    fun removeWord(word: String) = launch { store.setDictionary(state.value.voice.dictionary - word) }

    fun clearStatus() = status.update { if (it is KeyStatus.Checking) it else KeyStatus.None }

    private fun launch(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
    }

    companion object {
        const val MAX_WORD = 50
    }
}
