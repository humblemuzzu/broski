package com.muzammil.broski.feature.settings

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.settings.VoiceSettings
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.orb.OrbState
import uniffi.broski_core.dictationLanguages

/** Settings › Voice: the xAI key, the spoken language, sending after dictating, project words, and the person's own words. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun VoiceSettingsScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { VoiceSettingsViewModel(core.settingsStore, core.settings, core.dictation) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.voice_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
        ) {
            item(key = "key") { KeySection(state, viewModel) }
            dictation(state.voice, viewModel)
            words(state.voice.dictionary, viewModel)
        }
    }
}

@Composable
private fun KeySection(state: VoiceUiState, viewModel: VoiceSettingsViewModel) {
    val context = LocalContext.current
    var entry by rememberSaveable { mutableStateOf("") }
    SectionHeader(stringResource(R.string.voice_xai))
    val rows = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap)
    val key = state.key
    if (key != null) {
        SegmentedListItem(
            shapes = ListItemDefaults.segmentedShapes(0, 1),
            modifier = rows,
            supportingContent = { Text(masked(key), fontFamily = FontFamily.Monospace) },
            trailingContent = { TextButton(onClick = viewModel::removeKey) { Text(stringResource(R.string.voice_key_remove)) } },
            colors = groupedListItemColors(),
        ) { Text(stringResource(R.string.voice_key)) }
    } else {
        val save = { viewModel.saveKey(entry) { entry = "" } }
        OutlinedTextField(
            value = entry,
            onValueChange = {
                entry = it
                viewModel.clearStatus()
            },
            label = { Text(stringResource(R.string.voice_key_field)) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { save() }),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = save, enabled = entry.isNotBlank() && state.status != KeyStatus.Checking) {
                if (state.status == KeyStatus.Checking) {
                    Orb(OrbState.CONNECTING)
                    Text(stringResource(R.string.voice_key_checking), modifier = Modifier.padding(start = 8.dp))
                } else {
                    Text(stringResource(R.string.voice_key_save))
                }
            }
            TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, KEYS_URL.toUri())) }) {
                Text(stringResource(R.string.voice_key_get))
            }
        }
    }
    when (val status = state.status) {
        is KeyStatus.Said -> Note(stringResource(status.message))
        is KeyStatus.Failed -> Note(listOfNotNull(stringResource(status.problem.message), status.problem.detail).joinToString("\n"), error = true)
        KeyStatus.None, KeyStatus.Checking -> Unit
    }
    Note(stringResource(R.string.voice_key_footer))
}

@Composable
private fun Note(text: String, error: Boolean = false) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp),
    )
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private fun LazyListScope.dictation(voice: VoiceSettings, viewModel: VoiceSettingsViewModel) {
    item(key = "dictation") { SectionHeader(stringResource(R.string.voice_dictation)) }
    item(key = "language") { LanguageRow(voice.language, viewModel::setLanguage) }
    item(key = "send-after") {
        SwitchRow(R.string.voice_send_after, R.string.voice_send_after_body, voice.sendAfterDictating, 1, viewModel::setSendAfter)
    }
    item(key = "project-words") {
        SwitchRow(R.string.voice_project_words, R.string.voice_project_words_body, voice.projectWords, 2, viewModel::setProjectWords)
    }
    item(key = "language-note") {
        val formats = dictationLanguages().firstOrNull { it.code == voice.language }?.formats == true
        Note(stringResource(if (formats) R.string.voice_language_formats else R.string.voice_language_plain))
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun LanguageRow(language: String?, onPick: (String?) -> Unit) {
    val languages = remember { dictationLanguages() }
    var open by remember { mutableStateOf(false) }
    val detect = stringResource(R.string.voice_language_detect)
    Box {
        SegmentedListItem(
            onClick = { open = true },
            shapes = ListItemDefaults.segmentedShapes(0, 3),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
            supportingContent = { Text(languages.firstOrNull { it.code == language }?.name ?: detect) },
            trailingContent = { Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = null) },
            colors = groupedListItemColors(),
        ) { Text(stringResource(R.string.voice_language)) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(detect) }, onClick = { open = false; onPick(null) })
            languages.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.name) },
                    trailingIcon = if (option.code == language) ({ Icon(painterResource(R.drawable.ic_check), null) }) else null,
                    onClick = {
                        open = false
                        onPick(option.code)
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun SwitchRow(title: Int, body: Int, checked: Boolean, index: Int, onChange: (Boolean) -> Unit) {
    SegmentedListItem(
        checked = checked,
        onCheckedChange = onChange,
        shapes = ListItemDefaults.segmentedShapes(index, 3),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        supportingContent = { Text(stringResource(body)) },
        trailingContent = { Switch(checked = checked, onCheckedChange = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(title)) }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private fun LazyListScope.words(words: List<String>, viewModel: VoiceSettingsViewModel) {
    item(key = "words") { SectionHeader(stringResource(R.string.voice_words)) }
    itemsIndexed(words, key = { _, word -> "word:$word" }) { index, word ->
        SegmentedListItem(
            shapes = ListItemDefaults.segmentedShapes(index, words.size),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
            trailingContent = {
                IconButton(onClick = { viewModel.removeWord(word) }) {
                    Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.voice_words_remove, word))
                }
            },
            colors = groupedListItemColors(),
        ) { Text(word) }
    }
    item(key = "word-entry") { WordEntry(viewModel::addWord) }
    item(key = "words-note") { Note(stringResource(R.string.voice_words_body)) }
}

@Composable
private fun WordEntry(onAdd: (String) -> Unit) {
    var entry by rememberSaveable { mutableStateOf("") }
    val add = {
        onAdd(entry)
        entry = ""
    }
    Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = entry,
            onValueChange = { if (it.length <= VoiceSettingsViewModel.MAX_WORD) entry = it },
            label = { Text(stringResource(R.string.voice_words_add)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { add() }),
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = add, enabled = entry.isNotBlank()) { Text(stringResource(R.string.voice_words_add_action)) }
    }
}

/** `xai-…7Q2f`: enough to tell keys apart, never the key. */
internal fun masked(key: String): String {
    val prefix = key.substringBefore('-', missingDelimiterValue = "").takeIf { it.isNotEmpty() }?.let { "$it-" }.orEmpty()
    return "$prefix…${key.takeLast(4)}"
}

private const val KEYS_URL = "https://console.x.ai/team/default/api-keys"
