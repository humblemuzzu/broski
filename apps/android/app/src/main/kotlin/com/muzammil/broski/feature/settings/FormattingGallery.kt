package com.muzammil.broski.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.mono
import kotlinx.coroutines.delay
import uniffi.broski_core.FormatSample
import uniffi.broski_core.formatSamples

/** Characters per batch and the time between batches while replaying: the core streams at most 30 a second. */
private const val REPLAY_STEP = 12
private const val REPLAY_BATCH_MS = 33L

/**
 * Every sample the core's corpus holds (`formatSamples`), so the formatting is judged on the phone: at
 * every width and font scale, in both appearances, upright and sideways.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FormattingGallery(onDismiss: () -> Unit) {
    val samples = remember { formatSamples() }
    var open by rememberSaveable { mutableStateOf<Int?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        when (val index = open) {
            null -> SampleList(samples) { open = it }
            else -> {
                BackHandler { open = null }
                SampleView(samples[index]) { open = null }
            }
        }
    }
}

@Composable
private fun SampleList(samples: List<FormatSample>, onOpen: (Int) -> Unit) {
    Text(stringResource(R.string.format_gallery), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
    LazyColumn(Modifier.fillMaxSize()) {
        items(samples.indices.toList(), key = { samples[it].title }) { index ->
            Text(
                samples[index].title,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth().clickable { onOpen(index) }.padding(horizontal = 24.dp, vertical = 14.dp),
            )
        }
    }
}

/** One sample as an answer or a quiet row draws it, or as its source; Replay streams it in a batch at a time. */
@Composable
private fun SampleView(sample: FormatSample, onBack: () -> Unit) {
    var role by rememberSaveable { mutableStateOf(FormatRole.Page) }
    var source by rememberSaveable { mutableStateOf(false) }
    var replays by remember { mutableIntStateOf(0) }
    var streamed by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(replays) {
        if (replays == 0) return@LaunchedEffect
        var shown = 0
        while (shown < sample.text.length) {
            shown += REPLAY_STEP
            streamed = sample.text.take(shown)
            delay(REPLAY_BATCH_MS)
        }
        streamed = null
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.format_back)) }
            Text(sample.title, style = MaterialTheme.typography.titleMedium)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(role == FormatRole.Page, { role = FormatRole.Page }, { Text(stringResource(R.string.format_style_answer)) })
            FilterChip(role == FormatRole.Quiet, { role = FormatRole.Quiet }, { Text(stringResource(R.string.format_style_quiet)) })
            FilterChip(source, { source = !source }, { Text(stringResource(R.string.format_source)) })
            FilterChip(false, {
                source = false
                replays++
            }, { Text(stringResource(R.string.format_replay)) })
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp)) {
            if (source) {
                SelectionContainer { Text(sample.text, style = MaterialTheme.typography.bodySmall.mono()) }
            } else {
                FormattedText(streamed ?: sample.text, role = role, streaming = streamed != null)
            }
        }
    }
}
