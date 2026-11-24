package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import uniffi.broski_contract.CacheWindow
import uniffi.broski_contract.ContractOption
import uniffi.broski_contract.ModeAxis
import uniffi.broski_contract.ModelSummary
import uniffi.broski_contract.ThinkingOption
import uniffi.broski_contract.ThinkingSpec

/**
 * What the composer's pickers show and change: the agent the pins are kept for, the model, its
 * thinking, and each mode axis; and the session's prompt cache, which the model sheet warns about.
 */
@Immutable
data class ComposerSettings(
    val backend: String? = null,
    val models: List<ModelSummary> = emptyList(),
    val modelId: String? = null,
    val thinking: String? = null,
    val axes: List<ModeAxis> = emptyList(),
    val modes: Map<String, String> = emptyMap(),
    val cache: CacheWindow? = null,
) {
    val model: ModelSummary? get() =
        models.firstOrNull { it.id == modelId } ?: models.firstOrNull { it.isDefault } ?: models.firstOrNull()

    /** What the person just [picked], shown before the session reports it. */
    fun showing(picked: Picked?): ComposerSettings = if (picked == null) this else copy(
        modelId = picked.modelId ?: modelId,
        thinking = picked.thinking ?: thinking,
        modes = modes + picked.modes,
    )
}

/** A model, level or mode the person picked that the session has not reported yet. */
@Immutable
data class Picked(val modelId: String? = null, val thinking: String? = null, val modes: Map<String, String> = emptyMap()) {
    fun merge(next: Picked): Picked {
        val switched = next.modelId != null && next.modelId != modelId
        return Picked(
            modelId = next.modelId ?: modelId,
            thinking = if (switched) next.thinking else next.thinking ?: thinking,
            modes = modes + next.modes,
        )
    }
}

/** A model comes with the level last chosen on it, when it offers that level, applied after the model. */
@Immutable
class SettingActions(
    val model: (id: String, thinking: String?) -> Unit,
    val thinking: (String) -> Unit,
    val mode: (axis: String, value: String) -> Unit,
)

/**
 * What sits in the open composer's row between `+` and the mic: the model and its thinking level as
 * one pill, "Opus 5.5 High", which opens the model sheet; then each mode the session runs off its
 * usual value, so a session that is not as it usually is says so where the person types.
 */
@Composable
fun ComposerPickers(settings: ComposerSettings, actions: SettingActions, onOpenModel: () -> Unit) {
    val model = settings.model
    val name = model?.pillName ?: settings.modelId?.substringAfterLast('/')
    val level = model?.thinking?.title(settings.thinking)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (name != null) {
            val description = stringResource(R.string.composer_model_pill, listOfNotNull(name, level).joinToString(", "))
            PickerCapsule(Modifier.weight(1f, fill = false).semantics { contentDescription = description }, onClick = onOpenModel) {
                Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                level?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
            }
        }
        settings.axes.forEach { axis ->
            axis.changedOption(settings.modes[axis.id])?.let { option -> ModeChip(axis, option, actions) }
        }
    }
}

@Composable
private fun ModeChip(axis: ModeAxis, option: ContractOption, actions: SettingActions) {
    val haptics = LocalHapticFeedback.current
    var open by rememberSaveable { mutableStateOf(false) }
    Box {
        PickerCapsule(Modifier.semantics { contentDescription = "${axis.label}, ${option.label}" }, onClick = { open = true }) {
            Text(option.label, maxLines = 1)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            axis.options.forEach { choice ->
                DropdownMenuItem(
                    text = { OptionText(choice.label, choice.description) },
                    trailingIcon = if (choice.value == option.value) {
                        { Icon(painterResource(R.drawable.ic_check), contentDescription = null) }
                    } else {
                        null
                    },
                    onClick = {
                        open = false
                        if (choice.value != option.value) {
                            haptics.perform(Haptic.PickerStep)
                            actions.mode(axis.id, choice.value)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun PickerCapsule(modifier: Modifier, onClick: () -> Unit, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier
            .height(ComposerMetrics.CONTROL)
            .clip(CircleShape)
            .background(composerFill)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(
            LocalTextStyle provides MaterialTheme.typography.bodyLarge,
            LocalContentColor provides MaterialTheme.colorScheme.onSurface,
        ) { content() }
    }
}

@Composable
fun OptionText(label: String, detail: String?) {
    Column(Modifier.widthIn(max = 280.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/**
 * The name without what the agent adds in brackets ("Default (recommended)" is "Default"), short enough
 * for the composer's pill; lists show `displayName` whole.
 */
val ModelSummary.pillName: String
    get() {
        val open = displayName.lastIndexOf('(')
        if (!displayName.endsWith(")") || open <= 0) return displayName
        return displayName.substring(0, open).trim().ifEmpty { displayName }
    }

/** Who serves the model, as the agent names them. */
val ModelSummary.provider: String? get() = providerName ?: providerId

/** The level's title, the model's default standing in for none; `null` when neither is one of its levels. */
fun ThinkingSpec.title(value: String?): String? {
    val chosen = value ?: defaultValue ?: return null
    return options.firstOrNull { it.value == chosen }?.title
}

val ThinkingOption.title: String get() = label ?: value.replaceFirstChar(Char::uppercase)

/** What a session runs under unless told otherwise: the axis's default, else its first option. */
val ModeAxis.usualValue: String? get() = defaultValue ?: options.firstOrNull()?.value

/** The option [value] names when it is not the usual one. */
fun ModeAxis.changedOption(value: String?): ContractOption? =
    if (value == null || value == usualValue) null else options.firstOrNull { it.value == value }

fun ModeAxis.title(value: String?): String {
    val chosen = value ?: usualValue
    return options.firstOrNull { it.value == chosen }?.label ?: chosen ?: label
}
