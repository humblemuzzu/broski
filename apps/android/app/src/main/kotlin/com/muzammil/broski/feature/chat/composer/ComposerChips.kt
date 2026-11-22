package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.CacheSwitchNotice
import uniffi.broski_contract.CacheWindow
import uniffi.broski_contract.ModeAxis
import uniffi.broski_contract.ModelSummary

private val CHIP_LABEL_MAX = 160.dp

/** From this many models the chip opens a searchable sheet; fewer fit a menu. */
private const val SHEET_FROM = 13

/** What the composer's chips show and change: the model, its thinking, and each mode axis; and the session's prompt cache, which the model picker warns about. */
@Immutable
data class ComposerSettings(
    val models: List<ModelSummary> = emptyList(),
    val modelId: String? = null,
    val thinking: String? = null,
    val axes: List<ModeAxis> = emptyList(),
    val modes: Map<String, String> = emptyMap(),
    val cache: CacheWindow? = null,
) {
    val model: ModelSummary? get() = models.firstOrNull { it.id == modelId } ?: models.firstOrNull { it.isDefault }
}

@Immutable
class SettingActions(val model: (String) -> Unit, val thinking: (String) -> Unit, val mode: (axis: String, value: String) -> Unit)

/** The model chip (none with one model), the thinking chip when the model takes a level, and the mode axes after the first. */
@Composable
fun ModelChips(settings: ComposerSettings, actions: SettingActions) {
    val model = settings.model
    if (settings.models.size > 1 && model != null) ModelChip(settings, model, actions.model)
    val levels = model?.thinking?.options.orEmpty()
    if (levels.isNotEmpty()) {
        val current = settings.thinking ?: model?.thinking?.defaultValue
        val shown = levels.firstOrNull { it.value == current }
        Picker(
            label = shown?.let { it.label ?: it.value } ?: stringResource(R.string.composer_thinking),
            icon = R.drawable.ic_psychology,
            description = stringResource(R.string.composer_thinking),
            options = levels.map { PickerOption(it.value, it.label ?: it.value, it.description) },
            selected = current,
            onPick = actions.thinking,
        )
    }
    settings.axes.drop(1).forEach { ModeChip(it, settings, actions, CHIP_LABEL_MAX) }
}

/** The widest the first mode chip's words get before they cut off: the chip holds its place beside the send button. */
private val MODE_LABEL_MAX = 112.dp

/** The first mode axis (Claude Code's permission mode, Pi's permissions) kept beside the send button, where it is always seen. */
@Composable
fun PrimaryModeChip(settings: ComposerSettings, actions: SettingActions) {
    settings.axes.firstOrNull()?.let { ModeChip(it, settings, actions, MODE_LABEL_MAX) }
}

@Composable
private fun ModeChip(axis: ModeAxis, settings: ComposerSettings, actions: SettingActions, maxLabel: Dp) {
    val current = settings.modes[axis.id] ?: axis.defaultValue
    Picker(
        label = axis.options.firstOrNull { it.value == current }?.label ?: axis.label,
        icon = null,
        description = axis.label,
        options = axis.options.map { PickerOption(it.value, it.label, it.description) },
        selected = current,
        onPick = { actions.mode(axis.id, it) },
        maxLabel = maxLabel,
    )
}

@Composable
private fun ModelChip(settings: ComposerSettings, model: ModelSummary, onPick: (String) -> Unit) {
    if (settings.models.size < SHEET_FROM) {
        Picker(
            label = model.displayName,
            icon = null,
            description = stringResource(R.string.composer_model),
            options = settings.models.map { PickerOption(it.id, it.displayName, it.providerName ?: it.providerId) },
            selected = model.id,
            onPick = onPick,
            notice = { CacheSwitchNotice(settings.cache, Modifier.padding(horizontal = 12.dp, vertical = 8.dp).widthIn(max = 280.dp)) },
        )
    } else {
        var open by rememberSaveable { mutableStateOf(false) }
        Chip(model.displayName, null, stringResource(R.string.composer_model)) { open = true }
        if (open) ModelSheet(settings.models, model.id, settings.cache, onPick) { open = false }
    }
}

@Immutable
private class PickerOption(val value: String, val label: String, val detail: String?)

@Composable
private fun Picker(
    label: String,
    icon: Int?,
    description: String,
    options: List<PickerOption>,
    selected: String?,
    onPick: (String) -> Unit,
    maxLabel: Dp = CHIP_LABEL_MAX,
    notice: @Composable () -> Unit = {},
) {
    val haptics = LocalHapticFeedback.current
    var open by rememberSaveable { mutableStateOf(false) }
    Box {
        Chip(label, icon, description, maxLabel) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            notice()
            options.forEach { option ->
                DropdownMenuItem(
                    text = { OptionText(option.label, option.detail) },
                    trailingIcon = if (option.value == selected) {
                        { Icon(painterResource(R.drawable.ic_check), contentDescription = null) }
                    } else {
                        null
                    },
                    onClick = {
                        open = false
                        if (option.value != selected) {
                            haptics.perform(Haptic.PickerStep)
                            onPick(option.value)
                        }
                    },
                )
            }
        }
    }
}

@Composable
fun OptionText(label: String, detail: String?) {
    Column(Modifier.widthIn(max = 280.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** A quiet chip: the setting's value and a caret, no outline, as OpenCode's composer shows the model. */
@Composable
fun Chip(label: String, icon: Int?, description: String, maxLabel: Dp = CHIP_LABEL_MAX, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = 0f),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.heightIn(min = 40.dp),
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            icon?.let { Icon(painterResource(it), contentDescription = null, modifier = Modifier.size(18.dp).padding(end = 2.dp)) }
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = maxLabel),
            )
            Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = description, modifier = Modifier.size(18.dp))
        }
    }
}
