package com.muzammil.broski.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.activity.BackgroundTasksBar
import com.muzammil.broski.feature.chat.composer.CommandList
import com.muzammil.broski.feature.chat.composer.Composer
import com.muzammil.broski.feature.chat.composer.ComposerActions
import com.muzammil.broski.feature.chat.composer.ComposerLook
import com.muzammil.broski.feature.chat.composer.ComposerSettings
import com.muzammil.broski.feature.chat.composer.FileMentionPopup
import com.muzammil.broski.feature.chat.composer.SendFace
import com.muzammil.broski.feature.chat.composer.dictation.DictationHook
import com.muzammil.broski.feature.chat.composer.dictation.LocalDictation
import com.muzammil.broski.feature.chat.composer.SettingActions
import com.muzammil.broski.feature.chat.composer.matchingCommands
import com.muzammil.broski.feature.chat.composer.sendButton
import com.muzammil.broski.feature.chat.interactions.CardContext
import com.muzammil.broski.feature.chat.interactions.InteractionPanel
import uniffi.broski_contract.AttachmentKind
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.FileKind
import uniffi.broski_contract.PromptMode
import com.muzammil.broski.feature.workspace.Answer

/** Everything pinned at the bottom: what runs in the background, notices, the queue, the first ask, the commands list and the composer. */
@Composable
fun ChatBottom(model: ChatViewModel, openDiff: (FileChange) -> Unit, openVoiceSettings: () -> Unit, modifier: Modifier) {
    val live by model.live.collectAsStateWithLifecycle()
    val notices by model.notices.collectAsStateWithLifecycle()
    val answers by model.actions.answers.collectAsStateWithLifecycle()
    val header by model.header.collectAsStateWithLifecycle()
    val agent = header.agent.name
    val capabilities = live.capabilities
    val snapshot = live.snapshot
    val hasCards = snapshot.backgroundTasks.isNotEmpty() || live.ended != null || notices.isNotEmpty() || snapshot.queue.isNotEmpty()
    Column(
        modifier.imePadding().navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (hasCards) {
            Column(
                Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (snapshot.backgroundTasks.isNotEmpty()) BackgroundTasksBar(snapshot.backgroundTasks)
                live.ended?.let { end -> ViewEndCard(end, onRetry = model.feed::reattach) }
                notices.forEach { notice -> NoticeCard(notice, onDismiss = { model.dismiss(notice) }) }
                snapshot.queue.forEach { item ->
                    QueuedRow(item, onCancel = if (capabilities?.cancelQueued == true) ({ model.actions.cancelQueued(item.id) }) else null)
                }
            }
        }
        InteractionPanel(snapshot.interactions, context = { interaction ->
            CardContext(
                agent = agent,
                canAnswer = capabilities?.answer == true,
                state = answers[interaction.id],
                answer = { reply -> model.actions.answer(interaction.id, reply) },
                openDiff = openDiff,
            )
        })
        if (capabilities?.controllable == false) {
            WatchOnly()
        } else {
            ChatComposer(model, running = snapshot.run != null, openVoiceSettings)
        }
    }
}

@Composable
private fun ChatComposer(model: ChatViewModel, running: Boolean, openVoiceSettings: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val focus = LocalFocusManager.current
    val live by model.live.collectAsStateWithLifecycle()
    val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
    val command by model.composer.command.collectAsStateWithLifecycle()
    val images by model.composer.images.collectAsStateWithLifecycle()
    val text = model.composer.input.text.toString()
    val modes = catalog.capabilities?.promptModes ?: listOf(PromptMode.START)
    val button = sendButton(running, text.isNotBlank() || command != null || images.isNotEmpty(), modes, live.started && live.capabilities?.controllable == true)
    val picked by model.actions.picked.collectAsStateWithLifecycle()
    val settings = ComposerSettings(
        backend = model.sessionKey.backend,
        models = catalog.models,
        modelId = live.snapshot.modelId,
        thinking = live.snapshot.thinking,
        axes = catalog.modes,
        modes = live.snapshot.modes.associate { it.axis to it.value },
        cache = live.snapshot.usage?.cache,
    ).showing(picked)
    val actions = remember(model) {
        ComposerActions(
            onPress = { face ->
                if (face == SendFace.Stop) {
                    haptics.perform(Haptic.Stop)
                    model.actions.stop()
                } else {
                    haptics.perform(Haptic.Send)
                    model.actions.send(requireNotNull(face.mode))
                    focus.clearFocus()
                }
            },
            onImage = model.actions::attachImage,
            onNoImage = { model.say(ChatEvent.NoImageToPaste) },
            settings = SettingActions(model.actions::setModel, model.actions::setThinking, model.actions::setMode),
        )
    }
    val sendNow by rememberUpdatedState {
        if (button.enabled && button.face != SendFace.Stop) {
            button.face.mode?.let { mode ->
                haptics.perform(Haptic.Send)
                model.actions.send(mode)
            }
        }
    }
    val dictation = LocalDictation.current
    val hook = remember(dictation, model) {
        dictation?.let { DictationHook(it, model.dictationTarget(it) { sendNow() }, openVoiceSettings) }
    }
    val matching = if (command == null) matchingCommands(text, catalog.commands) else emptyList()
    if (matching.isNotEmpty()) CommandList(matching, onPick = model.composer::pick)
    val header by model.header.collectAsStateWithLifecycle()
    val cwd = header.cwd
    val selection = model.composer.input.selection
    FileMentionPopup(
        text = text,
        cursor = if (selection.collapsed) selection.end else null,
        commandActive = matching.isNotEmpty() || (command == null && text.startsWith("/") && !text.contains(' ') && !text.contains('\n')),
        root = cwd,
        search = { query ->
            val root = cwd ?: return@FileMentionPopup null
            when (val found = model.workspace.search(root, query, limit = 15L)) {
                is Answer.Done -> found.value.matches.map { if (it.kind == FileKind.DIR && !it.path.endsWith("/")) "${it.path}/" else it.path }
                is Answer.Failed -> null
            }
        },
        onPick = model.composer::pickFile,
    )
    Composer(
        state = model.composer,
        command = command,
        images = images,
        look = ComposerLook(
            placeholder = if (running && PromptMode.QUEUE in modes) stringResource(R.string.composer_placeholder_queue) else stringResource(R.string.composer_placeholder),
            button = button,
            images = catalog.capabilities?.attachments?.contains(AttachmentKind.IMAGE) == true,
            settings = settings,
            running = running,
        ),
        actions = actions,
        dictation = hook,
    )
}

@Composable
private fun WatchOnly() {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Text(
            stringResource(R.string.chat_watch_only),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(16.dp),
        )
    }
}

/** Round while nothing new came, a pill saying how much did. */
@Composable
fun JumpButton(unseen: Int, onClick: () -> Unit) {
    val label = if (unseen > 0) pluralStringResource(R.plurals.chat_new_messages, unseen, unseen) else stringResource(R.string.chat_jump_to_latest)
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        shadowElevation = 3.dp,
    ) {
        Row(Modifier.padding(if (unseen > 0) 12.dp else 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (unseen > 0) Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 6.dp, end = 6.dp))
            Icon(painterResource(R.drawable.ic_arrow_downward), contentDescription = label, modifier = Modifier.size(20.dp))
        }
    }
}
