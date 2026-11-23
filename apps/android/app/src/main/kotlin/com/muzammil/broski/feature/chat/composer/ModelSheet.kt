package com.muzammil.broski.feature.chat.composer

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.ModelPreferences
import androidx.compose.runtime.CompositionLocalProvider
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.LocalGroupedSheet
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.CacheSwitchNotice
import uniffi.broski_contract.ModelSummary

/** The person's pins and remembered levels, and how to change them; provided at the app's root. */
@Immutable
class ModelPreferencesHook(val value: ModelPreferences, val update: ((ModelPreferences) -> ModelPreferences) -> Unit)

val LocalModelPreferences = compositionLocalOf { ModelPreferencesHook(ModelPreferences()) {} }

/** Up to this many, the agent's models are all listed on top and there is no All Models. */
private const val LISTS_ALL_UP_TO = 6

private sealed interface Page {
    data object Models : Page
    data object Thinking : Page
    data class Mode(val axis: String) : Page
    data object AllModels : Page
}

/**
 * The model sheet, from the composer's pill. On top, the models to pick from: every one when the agent
 * lists a few, else the session's and the pinned ones (a long press unpins). Under them Thinking and
 * each mode, each opening its list; then All Models, searchable, where models are pinned. A model is
 * picked with the level last chosen on it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSheet(settings: ComposerSettings, actions: SettingActions, onDismiss: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val preferences = LocalModelPreferences.current
    val backend = settings.backend.orEmpty()
    var page by remember { mutableStateOf<Page>(Page.Models) }
    val current = settings.model

    fun pick(model: ModelSummary) {
        val now = settings.thinking
        if (current != null && now != null) preferences.update { it.remembering(now, current.id, backend) }
        val level = preferences.value.level(model.id, backend)?.takeIf { remembered -> model.thinking.options.any { it.value == remembered } }
        if (model.id != current?.id || (level != null && level != settings.thinking)) {
            haptics.perform(Haptic.PickerStep)
            actions.model(model.id, level)
        }
        onDismiss()
    }

    BackHandler(enabled = page != Page.Models) { page = Page.Models }
    CompositionLocalProvider(LocalGroupedSheet provides true) {
        ModalBottomSheet(
            onDismissRequest = onDismiss,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
            containerColor = Grouped.screen,
        ) {
            SheetHeader(
                title = when (val shown = page) {
                    Page.Models -> stringResource(R.string.composer_model)
                    Page.Thinking -> stringResource(R.string.composer_thinking)
                    is Page.Mode -> settings.axes.firstOrNull { it.id == shown.axis }?.label.orEmpty()
                    Page.AllModels -> stringResource(R.string.composer_all_models)
                },
                back = page != Page.Models,
                onLeading = { if (page == Page.Models) onDismiss() else page = Page.Models },
            )
            AnimatedContent(page, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "model sheet") { shown ->
                when (shown) {
                    Page.Models -> LazyColumn { modelsPage(settings, preferences, backend, ::pick) { page = it } }
                    Page.Thinking -> current?.let { model ->
                        OptionPage(
                            model.thinking.options.map { Choice(it.value, it.label ?: it.value.replaceFirstChar(Char::uppercase), it.description) },
                            chosen = settings.thinking ?: model.thinking.defaultValue,
                        ) { value ->
                            haptics.perform(Haptic.PickerStep)
                            preferences.update { it.remembering(value, model.id, backend) }
                            actions.thinking(value)
                            page = Page.Models
                        }
                    }
                    is Page.Mode -> settings.axes.firstOrNull { it.id == shown.axis }?.let { axis ->
                        OptionPage(axis.options.map { Choice(it.value, it.label, it.description) }, chosen = settings.modes[axis.id] ?: axis.usualValue) { value ->
                            haptics.perform(Haptic.PickerStep)
                            actions.mode(axis.id, value)
                            page = Page.Models
                        }
                    }
                    Page.AllModels -> ModelBrowser(settings.models, current?.id, backend, ::pick)
                }
            }
        }
    }
}

private fun LazyListScope.modelsPage(
    settings: ComposerSettings,
    preferences: ModelPreferencesHook,
    backend: String,
    pick: (ModelSummary) -> Unit,
    open: (Page) -> Unit,
) {
    val current = settings.model
    val listsAll = settings.models.size <= LISTS_ALL_UP_TO
    val pinned = preferences.value.pinned(backend).mapNotNull { id -> settings.models.firstOrNull { it.id == id } }
    val shown = when {
        listsAll -> settings.models
        current == null || pinned.any { it.id == current.id } -> pinned
        else -> listOf(current) + pinned
    }
    item { CacheSwitchNotice(settings.cache, Modifier.padding(horizontal = 24.dp, vertical = 8.dp)) }
    shown.forEachIndexed { index, model ->
        item(key = model.id) {
            val level = if (model.id == current?.id) settings.thinking else preferences.value.level(model.id, backend)
            val detail = model.description?.takeIf { it.isNotBlank() }
                ?: listOfNotNull(model.provider, model.thinking.title(level)).joinToString(" · ").ifEmpty { null }
            val isPinned = preferences.value.isPinned(model.id, backend)
            GroupedRow(
                index, shown.size,
                onClick = { pick(model) },
                onLongClick = if (isPinned) ({ preferences.update { it.pinning(false, model.id, backend) } }) else null,
                supporting = detail?.let { { Text(it, maxLines = 2) } },
                trailing = if (model.id == current?.id) ({ Check() }) else null,
            ) { Text(model.displayName) }
        }
    }
    if (!listsAll && pinned.isEmpty()) {
        item { Hint(stringResource(R.string.composer_pins_hint)) }
    }
    val levels = current?.thinking?.options.orEmpty()
    val rows = (if (levels.isNotEmpty()) 1 else 0) + settings.axes.size
    if (rows > 0) item { Spacer(Modifier.height(16.dp)) }
    if (levels.isNotEmpty()) {
        item {
            SettingRow(0, rows, stringResource(R.string.composer_thinking), current?.thinking?.title(settings.thinking) ?: stringResource(R.string.composer_thinking_default)) {
                open(Page.Thinking)
            }
        }
    }
    settings.axes.forEachIndexed { index, axis ->
        item(key = "axis:${axis.id}") {
            SettingRow(index + rows - settings.axes.size, rows, axis.label, axis.title(settings.modes[axis.id])) { open(Page.Mode(axis.id)) }
        }
    }
    if (!listsAll) {
        item { Spacer(Modifier.height(16.dp)) }
        item { SettingRow(0, 1, stringResource(R.string.composer_all_models), settings.models.size.toString()) { open(Page.AllModels) } }
    }
    item { Spacer(Modifier.height(24.dp)) }
}

@Immutable
private class Choice(val value: String, val title: String, val description: String?)

@Composable
private fun OptionPage(choices: List<Choice>, chosen: String?, pick: (String) -> Unit) {
    LazyColumn {
        choices.forEachIndexed { index, choice ->
            item(key = choice.value) {
                GroupedRow(
                    index, choices.size,
                    onClick = { pick(choice.value) },
                    supporting = choice.description?.let { { Text(it) } },
                    trailing = if (choice.value == chosen) ({ Check() }) else null,
                ) { Text(choice.title) }
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun SettingRow(index: Int, count: Int, title: String, value: String, onClick: () -> Unit) {
    GroupedRow(
        index, count,
        onClick = onClick,
        trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
    ) { Text(title) }
}

@Composable
private fun SheetHeader(title: String, back: Boolean, onLeading: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 8.dp)) {
        IconButton(onClick = onLeading, modifier = Modifier.align(Alignment.CenterStart)) {
            Icon(
                painterResource(if (back) R.drawable.ic_chevron_left else R.drawable.ic_close),
                contentDescription = stringResource(if (back) R.string.composer_back else R.string.composer_close),
            )
        }
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.align(Alignment.Center).semantics { heading() },
        )
    }
}

@Composable
fun Check() {
    Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
}

@Composable
fun Hint(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 32.dp, vertical = 8.dp),
    )
}
