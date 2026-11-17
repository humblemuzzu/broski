package com.muzammil.broski.feature.chat.transcript

import android.content.ClipData
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiMotion
import com.muzammil.broski.design.animationsEnabled
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import kotlinx.coroutines.launch
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.RunLimit

/** Rows that arrived this recently fade and rise in; older ones, remounted as the list scrolls, never do. */
private const val FRESH_MS = 3_000L

private const val NOTE_LINES = 3

/** A fade-and-rise for a row of the last few seconds (a fade alone with animations reduced). */
@Composable
fun Modifier.entrance(at: Long?): Modifier {
    val fresh = remember { at != null && System.currentTimeMillis() - at < FRESH_MS }
    if (!fresh) return this
    val moving = animationsEnabled()
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) { progress.animateTo(1f, BroskiMotion.spring()) }
    val rise = with(LocalDensity.current) { 12.dp.toPx() }
    return graphicsLayer {
        alpha = progress.value
        if (moving) translationY = (1f - progress.value) * rise
    }
}

/** A line between turns: a notice, a compaction, a model change, or a run that did not finish; three lines at most until tapped open. */
@Composable
fun NoteRow(note: TranscriptNote, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    val color = when {
        note is TranscriptNote.Notice && note.level == NoticeLevel.ERROR -> MaterialTheme.colorScheme.error
        note is TranscriptNote.Stopped && note.failure != null -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier.fillMaxWidth().clickable(onClickLabel = null) { open = !open },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
        val words = noteWords(note)
        Box(Modifier.weight(4f, fill = false).then(if (open) Modifier else Modifier.heightIn(max = NOTE_HEIGHT).clipToBounds())) {
            CompositionLocalProvider(LocalContentColor provides color) {
                FormattedMessage(words, role = FormatRole.Quiet)
            }
        }
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
private fun noteWords(note: TranscriptNote): String = when (note) {
    is TranscriptNote.Notice -> note.text
    is TranscriptNote.Compacted -> stringResource(R.string.chat_note_compacted)
    is TranscriptNote.ModelChanged -> note.modelId?.let { stringResource(R.string.chat_note_model, it) }
        ?: stringResource(R.string.chat_note_thinking, note.thinking.orEmpty())
    is TranscriptNote.Stopped -> when {
        note.failure != null -> stringResource(R.string.chat_note_failed, note.failure)
        note.limit != null -> stringResource(note.limit.words)
        else -> stringResource(R.string.chat_note_stopped)
    }
}

private val RunLimit.words: Int
    get() = when (this) {
        RunLimit.MAX_TURNS -> R.string.chat_note_limit_turns
        RunLimit.BUDGET -> R.string.chat_note_limit_budget
        RunLimit.OUTPUT_TOKENS -> R.string.chat_note_limit_output
    }

/** The quiet copy button under a finished answer. */
@Composable
fun CopyAnswerRow(text: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    Box(modifier.fillMaxWidth()) {
        IconButton(
            onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(text.take(40), text))) } },
            modifier = Modifier.size(36.dp),
        ) {
            Icon(
                painterResource(R.drawable.ic_content_copy),
                contentDescription = stringResource(R.string.chat_copy_answer),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** Earlier messages being read, at the top of the list. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun OlderRow(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        LoadingIndicator(Modifier.size(32.dp))
    }
}

/** A note shows about three lines until it is tapped open. */
private val NOTE_HEIGHT = 60.dp
