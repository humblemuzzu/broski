package com.muzammil.broski.feature.newsession

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.composer.Catalog
import com.muzammil.broski.feature.chat.composer.Composer
import com.muzammil.broski.feature.chat.composer.ComposerActions
import com.muzammil.broski.feature.chat.composer.ComposerLook
import com.muzammil.broski.feature.chat.composer.ComposerSettings
import com.muzammil.broski.feature.chat.composer.SettingActions
import com.muzammil.broski.feature.chat.composer.dictation.DictationHook
import com.muzammil.broski.feature.chat.composer.dictation.LocalDictation
import com.muzammil.broski.feature.chat.composer.sendButton
import com.muzammil.broski.feature.workspace.lastComponent
import uniffi.broski_contract.AttachmentKind
import uniffi.broski_contract.PromptMode

/** "What should we build in <folder>?" with the folder to tap, the machine, the agent, then the composer, keyboard up. */
@Composable
internal fun ColumnScope.Prompt(model: NewSessionViewModel, error: String?, close: () -> Unit) {
    val ui by model.state.collectAsStateWithLifecycle()
    val catalog by model.catalog.collectAsStateWithLifecycle()
    val choice = ui.choice
    TextButton(onClick = close, modifier = Modifier.padding(start = 8.dp)) { Text(stringResource(R.string.action_cancel)) }
    Spacer(Modifier.weight(1f))
    Headline(choice.folder) { choice.machineId?.let { model.folders.open(it, choice.folder) } }
    if (ui.machines.size > 1) MachinePicker(ui, model::pickMachine)
    Spacer(Modifier.weight(1f))
    AgentPicker(ui.agents, choice.backend, ui.machines.firstOrNull { it.id == choice.machineId }?.name.orEmpty(), model::pickAgent)
    error?.let {
        Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
    }
    NewSessionComposer(model, catalog, ui)
}

@Composable
private fun Headline(folder: String?, onFolder: () -> Unit) {
    val folderName = folder?.let(::lastComponent) ?: stringResource(R.string.new_session_a_folder)
    val linkStyle = TextLinkStyles(SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline))
    val pickLabel = stringResource(R.string.new_session_pick_folder)
    val text = buildAnnotatedString {
        append(stringResource(R.string.new_session_question_start))
        append("\n")
        append(stringResource(R.string.new_session_question_in))
        append(" ")
        withLink(LinkAnnotation.Clickable(pickLabel, linkStyle) { onFolder() }) { append(folderName) }
        append("?")
    }
    Text(text, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp))
}

@Composable
private fun MachinePicker(ui: NewSessionUi, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        TextButton(onClick = { open = true }) {
            Text(stringResource(R.string.new_session_on_machine, ui.machines.firstOrNull { it.id == ui.choice.machineId }?.name.orEmpty()))
            Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            ui.machines.forEach { machine ->
                DropdownMenuItem(
                    text = { Text(machine.name) },
                    trailingIcon = if (machine.id == ui.choice.machineId) ({ Icon(painterResource(R.drawable.ic_check), null) }) else null,
                    onClick = {
                        open = false
                        haptics.perform(Haptic.PickerStep)
                        onPick(machine.id)
                    },
                )
            }
        }
    }
}

@Composable
private fun NewSessionComposer(model: NewSessionViewModel, catalog: Catalog, ui: NewSessionUi) {
    val haptics = LocalHapticFeedback.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(focus) { focus.requestFocus() }
    val choice = ui.choice
    val command by model.composer.command.collectAsStateWithLifecycle()
    val images by model.composer.images.collectAsStateWithLifecycle()
    val ready = choice.machineId != null && choice.folder != null && choice.backend != null && !ui.creating
    val hasInput = model.composer.input.text.isNotBlank() || command != null || images.isNotEmpty()
    val settings = ComposerSettings(catalog.models, choice.modelId, choice.thinking, catalog.modes, choice.modes)
    val actions = remember(model) {
        ComposerActions(
            onPress = {
                haptics.perform(Haptic.Send)
                model.create()
            },
            onImage = model::attachImage,
            onNoImage = model::noImageToPaste,
            settings = SettingActions(model::pickModel, model::pickThinking, model::pickMode),
        )
    }
    val dictation = LocalDictation.current
    val hook = remember(dictation, model) { dictation?.let { DictationHook(it, model.dictationTarget(it), openVoiceSettings = null) } }
    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Composer(
            state = model.composer,
            command = command,
            images = images,
            look = ComposerLook(
                placeholder = stringResource(R.string.new_session_placeholder),
                button = sendButton(running = false, hasInput = hasInput, modes = listOf(PromptMode.START), controllable = ready),
                images = catalog.capabilities?.attachments?.contains(AttachmentKind.IMAGE) == true,
                settings = settings,
            ),
            actions = actions,
            focus = focus,
            dictation = hook,
        )
    }
}
