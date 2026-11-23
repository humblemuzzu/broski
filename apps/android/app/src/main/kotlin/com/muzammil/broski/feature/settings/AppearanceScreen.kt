package com.muzammil.broski.feature.settings

import android.os.Build
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.settings.AppSettings
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.DarkCanvas
import com.muzammil.broski.core.settings.InlineCodeStyle
import com.muzammil.broski.core.settings.KeepScreenAwake
import com.muzammil.broski.core.settings.ReadingDensity
import com.muzammil.broski.core.settings.ReadingFont
import com.muzammil.broski.core.settings.ReadingSettings
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.chatCanvas
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.LocalReading
import com.muzammil.broski.feature.usage.Segments

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

private const val PAGE_SIZE = 14.5f

/**
 * Settings › Appearance, as iOS lays it out: light or dark, the chat's dark background and keeping the
 * screen awake; how agents' text reads; a live sample on the chat's own page. On Android 12 and later,
 * matching the wallpaper's colours is a last section.
 */
@Composable
fun AppearanceScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val settings = state.settings
    SettingsPage(stringResource(R.string.settings_appearance), onBack) {
        display(settings, viewModel)
        reading(settings.reading, viewModel::setReading)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            item(key = "dynamic") {
                FormHeader("")
                FormToggle(0, 1, stringResource(R.string.settings_dynamic_color), settings.dynamicColor, viewModel::setDynamicColor)
                FormFooter(stringResource(R.string.settings_dynamic_color_body))
            }
        }
    }
}

private fun LazyListScope.display(settings: AppSettings, viewModel: SettingsViewModel) {
    item(key = "display") {
        val reading = settings.reading
        FormRow(0, 3) {
            Segments(
                Appearance.entries.toList(),
                settings.appearance,
                label = { stringResource(it.label) },
                onSelect = viewModel::setAppearance,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        FormMenuRow(
            1, 3, stringResource(R.string.settings_dark_canvas), DarkCanvas.entries.toList(), reading.darkCanvas,
            label = { stringResource(it.label) },
            onSelect = { viewModel.setReading(reading.copy(darkCanvas = it)) },
        )
        FormMenuRow(
            2, 3, stringResource(R.string.settings_keep_awake), KeepScreenAwake.entries.toList(), settings.keepScreenAwake,
            label = { stringResource(it.label) },
            onSelect = viewModel::setKeepScreenAwake,
        )
        FormFooter(stringResource(R.string.settings_appearance_footer))
    }
}

private fun LazyListScope.reading(reading: ReadingSettings, onChange: (ReadingSettings) -> Unit) {
    item(key = "reading") {
        val count = 6
        FormHeader(stringResource(R.string.format_reading))
        FormStepperRow(
            0, count, stringResource(R.string.format_reading_size), sizeLabel(reading.sizeSteps),
            canDecrease = reading.sizeSteps > ReadingSettings.SIZE_STEPS.first,
            canIncrease = reading.sizeSteps < ReadingSettings.SIZE_STEPS.last,
            onDecrease = { onChange(reading.copy(sizeSteps = reading.sizeSteps - 1)) },
            onIncrease = { onChange(reading.copy(sizeSteps = reading.sizeSteps + 1)) },
            decreaseLabel = stringResource(R.string.format_smaller),
            increaseLabel = stringResource(R.string.format_larger),
        )
        FormMenuRow(1, count, stringResource(R.string.format_reading_density), ReadingDensity.entries.toList(), reading.density, { stringResource(it.label) }) {
            onChange(reading.copy(density = it))
        }
        FormMenuRow(2, count, stringResource(R.string.format_reading_font), ReadingFont.entries.toList(), reading.font, { stringResource(it.label) }) {
            onChange(reading.copy(font = it))
        }
        FormMenuRow(3, count, stringResource(R.string.format_reading_inline_code), InlineCodeStyle.entries.toList(), reading.inlineCode, { stringResource(it.label) }) {
            onChange(reading.copy(inlineCode = it))
        }
        FormToggle(4, count, stringResource(R.string.format_reading_wrap), reading.wrapsCode, { onChange(reading.copy(wrapsCode = it)) })
        FormToggle(5, count, stringResource(R.string.format_reading_underline), reading.underlinesLinks, { onChange(reading.copy(underlinesLinks = it)) })
        FormFooter(stringResource(R.string.format_reading_footer))
    }
    item(key = "preview") {
        FormHeader(stringResource(R.string.settings_live_preview))
        CompositionLocalProvider(LocalReading provides reading) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Grouped.margin)
                    .clip(Grouped.shape(0, 1))
                    .background(chatCanvas)
                    .padding(horizontal = 24.dp, vertical = 28.dp),
            ) {
                FormattedText(SAMPLE, menu = false)
            }
        }
    }
}

@Composable
private fun sizeLabel(steps: Int): String {
    val size = PAGE_SIZE + steps
    val text = if (size % 1f == 0f) size.toInt().toString() else "%.1f".format(size)
    return stringResource(if (steps == 0) R.string.format_reading_size_default else R.string.format_reading_size_value, text)
}

private val Appearance.label: Int
    @StringRes get() = when (this) {
        Appearance.System -> R.string.settings_appearance_system
        Appearance.Light -> R.string.settings_appearance_light
        Appearance.Dark -> R.string.settings_appearance_dark
    }

private val DarkCanvas.label: Int
    @StringRes get() = when (this) {
        DarkCanvas.PureBlack -> R.string.settings_dark_canvas_black
        DarkCanvas.Charcoal -> R.string.settings_dark_canvas_charcoal
    }

private val KeepScreenAwake.label: Int
    @StringRes get() = when (this) {
        KeepScreenAwake.DictationOnly -> R.string.settings_keep_awake_dictation
        KeepScreenAwake.WhileWorking -> R.string.settings_keep_awake_working
        KeepScreenAwake.Always -> R.string.settings_keep_awake_always
    }

private val ReadingDensity.label: Int
    @StringRes get() = when (this) {
        ReadingDensity.Compact -> R.string.format_reading_density_compact
        ReadingDensity.Balanced -> R.string.format_reading_density_balanced
        ReadingDensity.Airy -> R.string.format_reading_density_airy
    }

private val ReadingFont.label: Int
    @StringRes get() = when (this) {
        ReadingFont.Sans -> R.string.format_reading_font_sans
        ReadingFont.Serif -> R.string.format_reading_font_serif
        ReadingFont.Mono -> R.string.format_reading_font_mono
    }

private val InlineCodeStyle.label: Int
    @StringRes get() = when (this) {
        InlineCodeStyle.Plain -> R.string.format_reading_inline_plain
        InlineCodeStyle.Tinted -> R.string.format_reading_inline_tinted
    }
