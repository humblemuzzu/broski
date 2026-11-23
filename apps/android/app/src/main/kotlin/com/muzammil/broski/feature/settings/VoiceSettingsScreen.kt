package com.muzammil.broski.feature.settings

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.settings.VoiceSettings
import com.muzammil.broski.design.Banner
import com.muzammil.broski.design.BannerStyle
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.IosText
import uniffi.broski_core.dictationLanguages

/** Settings › Voice: the xAI key, the spoken language, sending after dictating, project words, and the person's own words. */
@Composable
fun VoiceSettingsScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { VoiceSettingsViewModel(core.settingsStore, core.settings, core.dictation) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    SettingsPage(stringResource(R.string.voice_title), onBack) {
        item(key = "key") { KeySection(state, viewModel) }
        dictation(state.voice, viewModel)
        words(state.voice.dictionary, viewModel)
    }
}

@Composable
private fun KeySection(state: VoiceUiState, viewModel: VoiceSettingsViewModel) {
    val context = LocalContext.current
    var entry by rememberSaveable { mutableStateOf("") }
    val key = state.key
    val note = (state.status as? KeyStatus.Said)?.let { stringResource(it.message) }
    FormHeader(stringResource(R.string.voice_xai))
    if (key != null) {
        val count = if (note != null) 3 else 2
        FormValueRow(0, count, stringResource(R.string.voice_key), masked(key))
        FormButtonRow(1, count, stringResource(R.string.voice_key_remove), viewModel::removeKey, destructive = true)
        note?.let { NoteRow(2, count, it) }
    } else {
        val checking = state.status == KeyStatus.Checking
        val save = { viewModel.saveKey(entry) { entry = "" } }
        val count = if (note != null) 4 else 3
        FormTextField(
            0, count, entry,
            onValueChange = {
                entry = it
                viewModel.clearStatus()
            },
            placeholder = stringResource(R.string.voice_key_field),
            onDone = save,
            secure = true,
        )
        if (checking) {
            FormRow(1, count) {
                Orb(OrbState.CONNECTING)
                Text(stringResource(R.string.voice_key_checking), style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            FormButtonRow(1, count, stringResource(R.string.voice_key_save), save, enabled = entry.isNotBlank())
        }
        FormButtonRow(2, count, stringResource(R.string.voice_key_get), onClick = {
            context.startActivity(Intent(Intent.ACTION_VIEW, KEYS_URL.toUri()))
        })
        note?.let { NoteRow(3, count, it) }
    }
    (state.status as? KeyStatus.Failed)?.let { failed ->
        Banner(
            BannerStyle.Error,
            stringResource(failed.problem.message),
            modifier = Modifier.padding(horizontal = Grouped.margin).padding(top = 12.dp),
            detail = failed.problem.detail,
        )
    }
    FormFooter(stringResource(R.string.voice_key_footer))
}

@Composable
private fun NoteRow(index: Int, count: Int, text: String) {
    FormRow(index, count) {
        Text(text, style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun LazyListScope.dictation(voice: VoiceSettings, viewModel: VoiceSettingsViewModel) {
    item(key = "dictation") {
        val languages = remember { dictationLanguages() }
        val formats = languages.firstOrNull { it.code == voice.language }?.formats == true
        val detect = stringResource(R.string.voice_language_detect)
        FormHeader(stringResource(R.string.voice_dictation))
        FormMenuRow(
            0, 3, stringResource(R.string.voice_language),
            options = listOf<String?>(null) + languages.map { it.code },
            selected = voice.language,
            label = { code -> languages.firstOrNull { it.code == code }?.name ?: detect },
            onSelect = viewModel::setLanguage,
        )
        FormToggle(1, 3, stringResource(R.string.voice_send_after), voice.sendAfterDictating, viewModel::setSendAfter)
        FormToggle(2, 3, stringResource(R.string.voice_project_words), voice.projectWords, viewModel::setProjectWords)
        FormFooter(
            stringResource(if (formats) R.string.voice_language_formats else R.string.voice_language_plain) + " " +
                stringResource(R.string.voice_project_words_footer),
        )
    }
}

private fun LazyListScope.words(words: List<String>, viewModel: VoiceSettingsViewModel) {
    item(key = "words") { FormHeader(stringResource(R.string.voice_words)) }
    val count = words.size + 1
    words.forEachIndexed { index, word ->
        item(key = "word:$word") { WordRow(index, count, word) { viewModel.removeWord(word) } }
    }
    item(key = "word-entry") {
        WordEntry(words.size, count, words, viewModel::addWord)
        FormFooter(stringResource(R.string.voice_words_body))
    }
}

/** A word of the person's own; swiped toward the start it is deleted, as iOS's list deletes. */
@Composable
private fun WordRow(index: Int, count: Int, word: String, onDelete: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val swipe = rememberSwipeToDismissBoxState()
    val delete = stringResource(R.string.voice_words_delete)
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        onDismiss = {
            haptics.perform(Haptic.Warning)
            onDelete()
        },
        backgroundContent = {
            if (swipe.dismissDirection != SwipeToDismissBoxValue.Settled) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .padding(horizontal = Grouped.margin)
                        .background(MaterialTheme.colorScheme.error, Grouped.shape(index, count))
                        .padding(horizontal = 20.dp),
                    contentAlignment = Alignment.CenterEnd,
                ) {
                    Text(delete, style = IosText.body.copy(fontWeight = FontWeight.SemiBold), color = Color.White)
                }
            }
        },
        modifier = Modifier.semantics { customActions = listOf(CustomAccessibilityAction(delete) { onDelete(); true }) },
    ) {
        FormRow(index, count) { Text(word, style = IosText.body) }
    }
}

@Composable
private fun WordEntry(index: Int, count: Int, words: List<String>, onAdd: (String) -> Unit) {
    var entry by rememberSaveable { mutableStateOf("") }
    val word = entry.trim()
    val canAdd = word.isNotEmpty() && word.length <= VoiceSettingsViewModel.MAX_WORD && words.none { it.equals(word, ignoreCase = true) }
    val add = {
        if (canAdd) {
            onAdd(entry)
            entry = ""
        }
    }
    FormTextField(
        index, count, entry,
        onValueChange = { if (it.length <= VoiceSettingsViewModel.MAX_WORD) entry = it },
        placeholder = stringResource(R.string.voice_words_add),
        onDone = add,
    ) {
        Text(
            stringResource(R.string.voice_words_add_action),
            style = IosText.body,
            color = if (canAdd) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.clickable(enabled = canAdd, role = Role.Button, onClick = add).padding(vertical = 6.dp),
        )
    }
}

/** `xai-…7Q2f`: enough to tell keys apart, never the key. */
internal fun masked(key: String): String {
    val prefix = key.substringBefore('-', missingDelimiterValue = "").takeIf { it.isNotEmpty() }?.let { "$it-" }.orEmpty()
    return "$prefix…${key.takeLast(4)}"
}

private const val KEYS_URL = "https://console.x.ai/team/default/api-keys"
