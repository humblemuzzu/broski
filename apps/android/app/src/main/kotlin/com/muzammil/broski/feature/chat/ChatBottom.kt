package com.muzammil.broski.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import com.muzammil.broski.design.displayName
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.activity.BackgroundTasksBar
import com.muzammil.broski.feature.chat.composer.CommandList
import com.muzammil.broski.feature.chat.composer.Composer
import com.muzammil.broski.feature.chat.composer.ComposerActions
import com.muzammil.broski.feature.chat.composer.ComposerLook
import com.muzammil.broski.feature.chat.composer.ComposerSettings
import com.muzammil.broski.feature.chat.composer.SendFace
import com.muzammil.broski.feature.chat.composer.SettingActions
import com.muzammil.broski.feature.chat.composer.matchingCommands
import com.muzammil.broski.feature.chat.composer.sendButton
import com.muzammil.broski.feature.chat.interactions.CardContext
import com.muzammil.broski.feature.chat.interactions.InteractionPanel
import uniffi.broski_contract.AttachmentKind
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.PromptMode

/** Everything pinned at the bottom: what runs in the background, notices, the queue, the first ask, the commands list and the composer. */
@Composable
fun ChatBottom(model: ChatViewModel, openDiff: (FileChange) -> Unit, modifier: Modifier) {
    val live by model.live.collectAsStateWithLifecycle()
    val notices by model.notices.collectAsStateWithLifecycle()
    val answers by model.actions.answers.collectAsStateWithLifecycle()
    val header by model.header.collectAsStateWithLifecycle()
    val agent = stringResource(header.backend.displayName)
    val capabilities = live.capabilities
    val snapshot = live.snapshot
    Column(
        modifier.imePadding().navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (snapshot.backgroundTasks.isNotEmpty()) BackgroundTasksBar(snapshot.backgroundTasks)
        notices.forEach { notice -> NoticeCard(notice, onDismiss = { model.dismiss(notice) }) }
        snapshot.queue.forEach { item ->
            QueuedRow(item, onCancel = if (capabilities?.cancelQueued == true) ({ model.actions.cancelQueued(item.id) }) else null)
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
            ChatComposer(model, agent, running = snapshot.run != null)
        }
    }
}

@Composable
private fun ChatComposer(model: ChatViewModel, agent: String, running: Boolean) {
    val haptics = LocalHapticFeedback.current
    val focus = LocalFocusManager.current
    val live by model.live.collectAsStateWithLifecycle()
    val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
    val command by model.composer.command.collectAsStateWithLifecycle()
    val images by model.composer.images.collectAsStateWithLifecycle()
    val text = model.composer.input.text.toString()
    val modes = catalog.capabilities?.promptModes ?: listOf(PromptMode.START)
    val button = sendButton(running, text.isNotBlank() || command != null || images.isNotEmpty(), modes, live.started && live.capabilities?.controllable == true)
    val settings = ComposerSettings(
        models = catalog.models,
        modelId = live.snapshot.modelId,
        thinking = live.snapshot.thinking,
        axes = catalog.modes,
        modes = live.snapshot.modes.associate { it.axis to it.value },
    )
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
    val matching = if (command == null) matchingCommands(text, catalog.commands) else emptyList()
    if (matching.isNotEmpty()) CommandList(matching, onPick = model.composer::pick)
    Composer(
        state = model.composer,
        command = command,
        images = images,
        look = ComposerLook(
            placeholder = if (running) stringResource(R.string.composer_placeholder_queue) else stringResource(R.string.composer_placeholder, agent),
            button = button,
            images = catalog.capabilities?.attachments?.contains(AttachmentKind.IMAGE) == true,
            settings = settings,
        ),
        actions = actions,
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
