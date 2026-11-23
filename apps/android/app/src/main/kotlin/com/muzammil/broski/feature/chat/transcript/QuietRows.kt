package com.muzammil.broski.feature.chat.transcript

import android.content.ClipData
import android.text.format.DateFormat
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.style.TextAlign
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import java.util.Date
import kotlinx.coroutines.delay
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.staticCompositionLocalOf
import com.muzammil.broski.design.BroskiMotion
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.feature.chat.compactTokens
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.animationsEnabled
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import kotlinx.coroutines.launch
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.RunLimit

/** Rows that arrived this recently fade and rise in; older ones, remounted as the list scrolls, never do. */
private const val FRESH_MS = 3_000L

/** Lines of a note shown until it is tapped open. */
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

/** A model's display name by its id, from the chat's catalog; the id itself when it is not listed. */
val LocalModelNames = staticCompositionLocalOf<(String) -> String> { { it } }

/** A line between turns: something the agent said, as a quiet notice, or a compaction, a model change or how a run ended, as a marker. */
@Composable
fun NoteRow(note: TranscriptNote, modifier: Modifier = Modifier) {
    if (note is TranscriptNote.Notice) NoticeLine(note, modifier) else MarkerLine(note, modifier)
}

/** The agent's words that are not a turn: its level's symbol, then the words, three lines until tapped open. */
@Composable
private fun NoticeLine(note: TranscriptNote.Notice, modifier: Modifier) {
    var open by remember { mutableStateOf(false) }
    val (icon, tint) = when (note.level) {
        NoticeLevel.INFO -> R.drawable.ic_info to MaterialTheme.colorScheme.onSurfaceVariant
        NoticeLevel.WARNING -> R.drawable.ic_warning to BroskiTheme.semantic.caution
        NoticeLevel.ERROR -> R.drawable.ic_error to MaterialTheme.colorScheme.error
    }
    Row(
        modifier.fillMaxWidth().clickable(onClickLabel = null) { open = !open },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = tint, modifier = Modifier.padding(top = 2.dp).size(14.dp))
        val folded = FormatRole.Quiet.linesHeight(NOTE_LINES)
        Box(if (open) Modifier else Modifier.heightIn(max = folded).clipToBounds()) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
                FormattedMessage(note.text, role = FormatRole.Quiet)
            }
        }
    }
}

/** A compaction, a model change, or how a run ended, as a centred caption between two hairlines. */
@Composable
private fun MarkerLine(note: TranscriptNote, modifier: Modifier) {
    val rule = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    val failed = note is TranscriptNote.Stopped && note.failure != null
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider(Modifier.weight(1f), thickness = 1.dp, color = rule)
        Text(
            markerWords(note),
            fontSize = 12.sp,
            color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 280.dp),
        )
        HorizontalDivider(Modifier.weight(1f), thickness = 1.dp, color = rule)
    }
}

@Composable
private fun markerWords(note: TranscriptNote): String = when (note) {
    is TranscriptNote.Notice -> note.text
    is TranscriptNote.Compacted -> if (note.tokensBefore != null && note.tokensAfter != null) {
        stringResource(R.string.chat_note_compacted_counts, compactTokens(note.tokensBefore), compactTokens(note.tokensAfter))
    } else {
        stringResource(R.string.chat_note_compacted)
    }
    is TranscriptNote.ModelChanged -> {
        val name = note.modelId?.let(LocalModelNames.current)
        val thinking = note.thinking?.replaceFirstChar(Char::uppercaseChar)
        when {
            name != null && thinking != null -> stringResource(R.string.chat_note_model_thinking, name, thinking)
            name != null -> stringResource(R.string.chat_note_model, name)
            thinking != null -> stringResource(R.string.chat_note_thinking, thinking)
            else -> stringResource(R.string.chat_note_default_model)
        }
    }
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

/**
 * Under a finished answer: the quiet copy button, a check for a moment once copied, and the time the
 * answer came, as iOS ends an answer.
 */
@Composable
fun CopyAnswerRow(text: String, at: Long?, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var copies by remember { mutableIntStateOf(0) }
    LaunchedEffect(copies) {
        if (copies > 0) {
            delay(1_500)
            copies = 0
        }
    }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier.size(28.dp).clickable(onClickLabel = stringResource(R.string.chat_copy_answer)) {
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(text.take(40), text))) }
                haptics.perform(Haptic.Success)
                copies += 1
            },
            contentAlignment = Alignment.CenterStart,
        ) {
            Icon(
                painterResource(if (copies > 0) R.drawable.ic_check else R.drawable.ic_content_copy),
                contentDescription = stringResource(R.string.chat_copy_answer),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(15.dp),
            )
        }
        at?.let {
            Text(
                remember(it) { DateFormat.getTimeFormat(context).format(Date(it)) },
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Earlier messages being read, at the top of the list. */
@Composable
fun OlderRow(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
        LoadingOrb(label = stringResource(R.string.chat_loading_older))
    }
}

