package com.muzammil.broski.feature.chat.work

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.IosText

/** Disclosure rotation and fold expansion timing. */
private const val DISCLOSURE_MS = 180

/**
 * One stretch of work as one muted line, `Worked for 2m · Read 3 files · Ran 2 commands ›`, its
 * counts ticking as calls arrive; a tap opens its rows in place, capped so the answer stays near.
 */
@Composable
fun WorkFoldRow(
    fold: WorkFold,
    expanded: Boolean,
    onToggle: () -> Unit,
    entryExpanded: (String) -> Boolean,
    onToggleEntry: (String) -> Unit,
    actions: WorkActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth()) {
        WorkSummaryLine(fold, expanded, onToggle)
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(tween(DISCLOSURE_MS)) + fadeIn(tween(DISCLOSURE_MS)),
            exit = shrinkVertically(tween(DISCLOSURE_MS)) + fadeOut(tween(DISCLOSURE_MS)),
        ) {
            WorkEntries(fold.entries, entryExpanded, onToggleEntry, actions)
        }
    }
}

/** A turn's work as one muted line above its answer; a tap shows the rows it holds (`WorkGroups`). */
@Composable
fun WorkGroupRow(summary: WorkFold, expanded: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    WorkSummaryLine(summary, expanded, onToggle, modifier)
}

/** The one muted line of a fold or a group: its sentence and a chevron that turns; a tap opens it. */
@Composable
private fun WorkSummaryLine(fold: WorkFold, expanded: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    val parts = foldParts(fold)
    val sentence = parts.joinToString(" · ") { it.text }
    val stateWords = stringResource(if (expanded) R.string.chat_work_expanded else R.string.chat_work_collapsed)
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 28.dp)
            .clickable {
                haptics.perform(if (expanded) Haptic.Collapse else Haptic.Expand)
                onToggle()
            }
            .clearAndSetSemantics {
                contentDescription = sentence
                stateDescription = stateWords
                role = Role.Button
                onClick { onToggle(); true }
            },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        FoldSentence(parts, Modifier.weight(1f, fill = false))
        Disclosure(expanded)
    }
}

@Composable
private fun Disclosure(expanded: Boolean) {
    val turn by animateFloatAsState(if (expanded) 90f else 0f, tween(DISCLOSURE_MS), label = "disclosure")
    Icon(
        painterResource(R.drawable.ic_chevron_right),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        modifier = Modifier.size(14.dp).rotate(turn),
    )
}

/** One phrase of the fold's sentence; [count] is what ticks, [error] marks the failures. */
private class FoldPart(val key: String, val text: String, val count: Int, val error: Boolean = false)

@Composable
private fun FoldSentence(parts: List<FoldPart>, modifier: Modifier) {
    FlowRow(modifier, itemVerticalAlignment = Alignment.CenterVertically) {
        parts.forEachIndexed { index, part ->
            if (index > 0) FoldText(" · ", MaterialTheme.colorScheme.onSurfaceVariant)
            AnimatedContent(
                targetState = part,
                contentKey = { it.count },
                transitionSpec = { slideInVertically { it } + fadeIn() togetherWith slideOutVertically { -it } + fadeOut() },
                label = part.key,
            ) { shown ->
                FoldText(shown.text, if (shown.error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun FoldText(text: String, color: Color) {
    Text(text, style = IosText.subheadline, color = color, maxLines = 1)
}

@Composable
private fun foldParts(fold: WorkFold): List<FoldPart> {
    val lead = leadWords(fold)?.let { FoldPart("lead", it, 0) }
    val counts = fold.counts.map { FoldPart(it.verb.name, it.phrase, it.count.toInt()) }
    val failed = if (fold.failed > 0) FoldPart("failed", pluralStringResource(R.plurals.chat_work_failed, fold.failed, fold.failed), fold.failed, error = true) else null
    val thought = if (fold.thoughtOnly && lead == null) {
        FoldPart("thought", stringResource(if (fold.live) R.string.chat_work_thinking else R.string.chat_work_thought), 0)
    } else {
        null
    }
    return listOfNotNull(lead, thought) + counts + listOfNotNull(failed)
}

@Composable
private fun leadWords(fold: WorkFold): String? {
    val duration = fold.durationMs?.takeIf { it >= 1_000L }?.let { duration(it) }
    val hasSummary = fold.counts.isNotEmpty() || fold.failed > 0
    return when (fold.lead) {
        FoldLead.None -> null
        FoldLead.Worked -> when {
            fold.thoughtOnly -> duration?.let { stringResource(R.string.chat_work_thought_for, it) }
                ?: stringResource(if (fold.live) R.string.chat_work_thinking else R.string.chat_work_thought)
            fold.live -> if (hasSummary) null else stringResource(R.string.chat_work_working)
            else -> duration?.let { stringResource(R.string.chat_work_worked_for, it) }
                ?: if (hasSummary) null else stringResource(R.string.chat_work_worked)
        }
        FoldLead.Continued -> duration?.let { stringResource(R.string.chat_work_continued_for, it) }
            ?: if (hasSummary) null else stringResource(R.string.chat_work_continued)
    }
}

/** `12s`, `2m`, `1h 5m`: how long work took, the way the header's timer counts. */
@Composable
fun duration(ms: Long): String {
    val seconds = ms / 1_000
    return when {
        seconds < 60 -> stringResource(R.string.duration_seconds, seconds)
        seconds < 3_600 -> stringResource(R.string.duration_minutes, seconds / 60)
        else -> stringResource(R.string.duration_hours_minutes, seconds / 3_600, seconds % 3_600 / 60)
    }
}
