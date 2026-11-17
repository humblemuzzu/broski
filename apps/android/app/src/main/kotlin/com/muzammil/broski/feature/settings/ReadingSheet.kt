package com.muzammil.broski.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.settings.ReadingSettings
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.LocalReading

private val SAMPLE = """
## Fixed the reconnect test

The route race now cancels the loser **before** it resumes, so the queue is replayed once. See [the change](https://github.com) in `route_race.rs`.

- Added a paused-clock test
- Ran it 50 times in a row

```rust
if generation < self.generation { return Vec::new(); }
```
""".trimIndent()

/** Settings › Reading: how agents' text reads, on top of the phone's font size, with a sample that shows each change. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadingSheet(reading: ReadingSettings, onChange: (ReadingSettings) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.format_reading), style = MaterialTheme.typography.titleLarge)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.format_reading_size), style = MaterialTheme.typography.bodyLarge)
                    Text(
                        if (reading.sizeSteps == 0) stringResource(R.string.format_reading_size_system) else "%+d".format(reading.sizeSteps),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                FilledTonalIconButton(onClick = { onChange(reading.copy(sizeSteps = reading.sizeSteps - 1)) }, enabled = reading.sizeSteps > ReadingSettings.SIZE_STEPS.first) {
                    Icon(painterResource(R.drawable.ic_remove), stringResource(R.string.format_smaller))
                }
                FilledTonalIconButton(onClick = { onChange(reading.copy(sizeSteps = reading.sizeSteps + 1)) }, enabled = reading.sizeSteps < ReadingSettings.SIZE_STEPS.last) {
                    Icon(painterResource(R.drawable.ic_add), stringResource(R.string.format_larger))
                }
            }
            Toggle(R.string.format_reading_compact, reading.compact) { onChange(reading.copy(compact = it)) }
            Toggle(R.string.format_reading_wrap, reading.wrapsCode) { onChange(reading.copy(wrapsCode = it)) }
            Toggle(R.string.format_reading_underline, reading.underlinesLinks) { onChange(reading.copy(underlinesLinks = it)) }
            Text(stringResource(R.string.format_reading_footer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(stringResource(R.string.format_reading_preview), style = MaterialTheme.typography.titleSmall)
            CompositionLocalProvider(LocalReading provides reading) { FormattedText(SAMPLE, menu = false) }
        }
    }
}

@Composable
private fun Toggle(label: Int, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(label), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
