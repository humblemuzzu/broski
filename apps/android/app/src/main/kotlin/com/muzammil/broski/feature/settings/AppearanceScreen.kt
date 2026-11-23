package com.muzammil.broski.feature.settings

import android.os.Build
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.InlineCodeStyle
import com.muzammil.broski.core.settings.KeepScreenAwake
import com.muzammil.broski.core.settings.ReadingDensity
import com.muzammil.broski.core.settings.ReadingFont
import com.muzammil.broski.core.settings.ReadingSettings
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.LocalReading
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.perform

private data class AppearanceOption(val appearance: Appearance, @param:StringRes val label: Int, @param:DrawableRes val icon: Int)

private val AppearanceOptions = listOf(
    AppearanceOption(Appearance.System, R.string.settings_appearance_system, R.drawable.ic_brightness_auto),
    AppearanceOption(Appearance.Light, R.string.settings_appearance_light, R.drawable.ic_light_mode),
    AppearanceOption(Appearance.Dark, R.string.settings_appearance_dark, R.drawable.ic_dark_mode),
)

private data class KeepAwakeOption(val mode: KeepScreenAwake, @param:StringRes val label: Int)

private val KeepAwakeOptions = listOf(
    KeepAwakeOption(KeepScreenAwake.DictationOnly, R.string.settings_keep_awake_dictation),
    KeepAwakeOption(KeepScreenAwake.WhileWorking, R.string.settings_keep_awake_working),
    KeepAwakeOption(KeepScreenAwake.Always, R.string.settings_keep_awake_always),
)

private val SAMPLE = """
## Fixed the reconnect test

The route race now cancels the loser **before** it resumes, so the queue replays once. See [the change](https://github.com) in `route_race.rs:42`.

- **Clean inline code:** `set_model` and `compact` read without heavy boxes
  - Nested points stay airy with clear rhythm
- **True OLED black:** high-contrast typography on pure black

```rust
if generation < self.generation { return Vec::new(); }
```
""".trimIndent()

private const val STACKED_FONT_SCALE = 1.3f

/** Settings › Appearance: light or dark, the wallpaper's colours, keeping the screen awake, and how agents' text reads, with a sample. */
@Composable
fun AppearanceScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val settings = state.settings
    SettingsPage(stringResource(R.string.settings_appearance), onBack) {
        item(key = "theme") {
            AppearancePicker(settings.appearance, viewModel::setAppearance)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) DynamicColorRow(settings.dynamicColor, viewModel::setDynamicColor)
        }
        keepAwake(settings.keepScreenAwake, viewModel::setKeepScreenAwake)
        reading(settings.reading, viewModel::setReading)
    }
}

/**
 * A connected button group; at large font scales three labels no longer fit a row, so the options
 * stack as full-width toggle buttons.
 */
@Composable
private fun AppearancePicker(selected: Appearance, onSelect: (Appearance) -> Unit) {
    val haptics = LocalHapticFeedback.current
    val stacked = LocalDensity.current.fontScale > STACKED_FONT_SCALE
    val option: @Composable (Int, AppearanceOption, Modifier) -> Unit = { index, option, modifier ->
        ToggleButton(
            checked = selected == option.appearance,
            onCheckedChange = {
                if (selected != option.appearance) haptics.perform(Haptic.PickerStep)
                onSelect(option.appearance)
            },
            modifier = modifier.semantics { role = Role.RadioButton },
            shapes = when {
                stacked -> ToggleButtonDefaults.shapesFor(ToggleButtonDefaults.size)
                index == 0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                index == AppearanceOptions.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
            },
        ) {
            Icon(painterResource(option.icon), contentDescription = null, modifier = Modifier.padding(end = ToggleButtonDefaults.IconSpacing))
            Text(stringResource(option.label), maxLines = 1)
        }
    }
    if (stacked) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AppearanceOptions.forEachIndexed { index, it -> option(index, it, Modifier.fillMaxWidth()) }
        }
    } else {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween),
        ) {
            AppearanceOptions.forEachIndexed { index, it -> option(index, it, Modifier.weight(1f)) }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun DynamicColorRow(enabled: Boolean, onChange: (Boolean) -> Unit) {
    SegmentedListItem(
        checked = enabled,
        onCheckedChange = onChange,
        shapes = ListItemDefaults.segmentedShapes(0, 1),
        modifier = Modifier.padding(horizontal = 16.dp).padding(top = 12.dp),
        supportingContent = { Text(stringResource(R.string.settings_dynamic_color_body)) },
        trailingContent = { Switch(checked = enabled, onCheckedChange = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.settings_dynamic_color)) }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private fun LazyListScope.keepAwake(selected: KeepScreenAwake, onSelect: (KeepScreenAwake) -> Unit) {
    item(key = "keep_awake") { SectionHeader(stringResource(R.string.settings_keep_awake)) }
    KeepAwakeOptions.forEachIndexed { index, option ->
        item(key = "keep_awake:${option.mode}") {
            val checked = selected == option.mode
            SegmentedListItem(
                selected = checked,
                onClick = { onSelect(option.mode) },
                shapes = ListItemDefaults.segmentedShapes(index, KeepAwakeOptions.size),
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                trailingContent = if (checked) ({ Icon(painterResource(R.drawable.ic_check), contentDescription = null) }) else null,
                colors = groupedListItemColors(),
            ) { Text(stringResource(option.label)) }
        }
    }
    item(key = "keep_awake_body") { SettingsFooter(stringResource(R.string.settings_keep_awake_body)) }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
private fun LazyListScope.reading(reading: ReadingSettings, onChange: (ReadingSettings) -> Unit) {
    val totalRows = 6
    item(key = "reading") { SectionHeader(stringResource(R.string.format_reading)) }
    item(key = "reading:size") {
        SegmentedListItem(
            shapes = ListItemDefaults.segmentedShapes(0, totalRows),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
            supportingContent = {
                Text(if (reading.sizeSteps == 0) stringResource(R.string.format_reading_size_system) else "%+d".format(reading.sizeSteps))
            },
            trailingContent = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    FilledTonalIconButton(
                        onClick = { onChange(reading.copy(sizeSteps = reading.sizeSteps - 1)) },
                        enabled = reading.sizeSteps > ReadingSettings.SIZE_STEPS.first,
                    ) { Icon(painterResource(R.drawable.ic_remove), stringResource(R.string.format_smaller)) }
                    FilledTonalIconButton(
                        onClick = { onChange(reading.copy(sizeSteps = reading.sizeSteps + 1)) },
                        enabled = reading.sizeSteps < ReadingSettings.SIZE_STEPS.last,
                    ) { Icon(painterResource(R.drawable.ic_add), stringResource(R.string.format_larger)) }
                }
            },
            colors = groupedListItemColors(),
        ) { Text(stringResource(R.string.format_reading_size)) }
    }
    item(key = "reading:density") {
        val label = when (reading.density) {
            ReadingDensity.Compact -> R.string.format_reading_density_compact
            ReadingDensity.Balanced -> R.string.format_reading_density_balanced
            ReadingDensity.Airy -> R.string.format_reading_density_airy
        }
        SegmentedListItem(
            onClick = {
                val all = ReadingDensity.entries
                val next = all[(all.indexOf(reading.density) + 1) % all.size]
                onChange(reading.copy(density = next))
            },
            shapes = ListItemDefaults.segmentedShapes(1, totalRows),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
            trailingContent = { Text(stringResource(label), color = MaterialTheme.colorScheme.onSurfaceVariant) },
            colors = groupedListItemColors(),
        ) { Text(stringResource(R.string.format_reading_density)) }
    }
    item(key = "reading:font") {
        val label = when (reading.font) {
            ReadingFont.Sans -> R.string.format_reading_font_sans
            ReadingFont.Serif -> R.string.format_reading_font_serif
            ReadingFont.Mono -> R.string.format_reading_font_mono
        }
        SegmentedListItem(
            onClick = {
                val all = ReadingFont.entries
                val next = all[(all.indexOf(reading.font) + 1) % all.size]
                onChange(reading.copy(font = next))
            },
            shapes = ListItemDefaults.segmentedShapes(2, totalRows),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
            trailingContent = { Text(stringResource(label), color = MaterialTheme.colorScheme.onSurfaceVariant) },
            colors = groupedListItemColors(),
        ) { Text(stringResource(R.string.format_reading_font)) }
    }
    item(key = "reading:inline") {
        val label = when (reading.inlineCode) {
            InlineCodeStyle.Plain -> R.string.format_reading_inline_plain
            InlineCodeStyle.Tinted -> R.string.format_reading_inline_tinted
        }
        SegmentedListItem(
            onClick = {
                val next = if (reading.inlineCode == InlineCodeStyle.Plain) InlineCodeStyle.Tinted else InlineCodeStyle.Plain
                onChange(reading.copy(inlineCode = next))
            },
            shapes = ListItemDefaults.segmentedShapes(3, totalRows),
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
            trailingContent = { Text(stringResource(label), color = MaterialTheme.colorScheme.onSurfaceVariant) },
            colors = groupedListItemColors(),
        ) { Text(stringResource(R.string.format_reading_inline_code)) }
    }
    val toggles = listOf(
        R.string.format_reading_wrap to reading.wrapsCode,
        R.string.format_reading_underline to reading.underlinesLinks,
    )
    toggles.forEachIndexed { index, (label, checked) ->
        item(key = "reading:$label") {
            SegmentedListItem(
                checked = checked,
                onCheckedChange = { on ->
                    onChange(
                        when (label) {
                            R.string.format_reading_wrap -> reading.copy(wrapsCode = on)
                            else -> reading.copy(underlinesLinks = on)
                        },
                    )
                },
                shapes = ListItemDefaults.segmentedShapes(index + 4, totalRows),
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                trailingContent = { Switch(checked = checked, onCheckedChange = null) },
                colors = groupedListItemColors(),
            ) { Text(stringResource(label)) }
        }
    }
    item(key = "reading:footer") { SettingsFooter(stringResource(R.string.format_reading_footer)) }
    item(key = "reading:preview") {
        Spacer(Modifier.height(12.dp))
        Surface(
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        ) {
            CompositionLocalProvider(LocalReading provides reading) {
                FormattedText(SAMPLE, menu = false, modifier = Modifier.padding(16.dp))
            }
        }
    }
}
