package com.muzammil.broski.feature.chat.activity

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.format.FormatCache
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.format.FormattedText
import com.muzammil.broski.design.format.tools.CommandLine
import com.muzammil.broski.design.format.tools.LogLines
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.work.TextPage
import com.muzammil.broski.feature.chat.work.WorkActions
import uniffi.broski_contract.Activity
import uniffi.broski_contract.ActivityBody
import uniffi.broski_contract.ActivityFormat
import uniffi.broski_contract.ActivityKind
import uniffi.broski_core.ActivityLook
import uniffi.broski_core.ActivityTone
import uniffi.broski_core.ClipEnd
import uniffi.broski_core.clipText
import uniffi.broski_core.formatLog

private const val DISCLOSURE_MS = 180

/** Blocks of a message an opened row draws, and lines of a text; the rest is in the sheet. */
private const val SHOWN_BLOCKS = 8
private const val TEXT_LINES = 20u

/**
 * Something that happened that is not a turn (a background task's end, a subagent's report, a
 * command's output, an extension's message), as one quiet line like a row of work: its kind, what
 * happened, how long it took. It opens in place to what it carries, each part capped, and the whole
 * of a long body opens in a sheet.
 */
@Composable
fun ActivityRow(activity: Activity, look: ActivityLook, expanded: Boolean, onToggle: () -> Unit, actions: WorkActions, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    val stateWords = stringResource(if (expanded) R.string.chat_work_expanded else R.string.chat_work_collapsed)
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 36.dp)
                .clickable(enabled = look.opens) {
                    haptics.perform(if (expanded) Haptic.Collapse else Haptic.Expand)
                    onToggle()
                }
                .semantics(mergeDescendants = true) {
                    if (look.opens) {
                        stateDescription = stateWords
                        role = Role.Button
                    }
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(painterResource(activity.kind.icon), contentDescription = null, tint = look.tone.color(), modifier = Modifier.size(18.dp))
            Column(Modifier.weight(1f).padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    activity.title,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = if (expanded) Int.MAX_VALUE else 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val preview = look.preview
                if (!expanded && preview != null) {
                    Text(preview, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (look.facts.isNotEmpty()) {
                Text(
                    look.facts.joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (look.tone == ActivityTone.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (look.opens) Disclosure(expanded)
        }
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(tween(DISCLOSURE_MS)) + fadeIn(tween(DISCLOSURE_MS)),
            exit = shrinkVertically(tween(DISCLOSURE_MS)) + fadeOut(tween(DISCLOSURE_MS)),
        ) {
            ActivityDetail(activity, look, actions)
        }
    }
}

@Composable
private fun Disclosure(expanded: Boolean) {
    val turn by animateFloatAsState(if (expanded) 90f else 0f, tween(DISCLOSURE_MS), label = "disclosure")
    Icon(
        painterResource(R.drawable.ic_chevron_right),
        contentDescription = null,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(18.dp).rotate(turn),
    )
}

/** An opened activity: the command, the body (a log's last lines, a message's first blocks, a text's first lines), the subagent. */
@Composable
private fun ActivityDetail(activity: Activity, look: ActivityLook, actions: WorkActions) {
    Column(Modifier.fillMaxWidth().padding(start = 28.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        activity.command?.takeIf { it.isNotEmpty() }?.let { command ->
            CommandLine(command)
        }
        activity.body?.let { body -> ActivityBodyView(activity.title, body, look, actions) }
        activity.childSession?.let { child ->
            TextButton(onClick = { actions.openSession(child) }) {
                Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null, modifier = Modifier.size(16.dp))
                Text(stringResource(R.string.chat_work_open_subagent), modifier = Modifier.padding(start = 6.dp))
            }
        }
    }
}

@Composable
private fun ActivityBodyView(title: String, body: ActivityBody, look: ActivityLook, actions: WorkActions) {
    val page = TextPage(title, body.text, TextPage.formatOf(body.format))
    when (body.format) {
        ActivityFormat.LOG -> look.log?.let { log ->
            val lines = remember(log.text) { formatLog(log.text, UInt.MAX_VALUE, ClipEnd.TAIL).lines }
            Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = Modifier.fillMaxWidth()) {
                LogLines(lines, MaterialTheme.typography.bodySmall.mono(), MaterialTheme.colorScheme.onSurfaceVariant, Modifier.padding(8.dp))
            }
            if (log.hiddenLines > 0u) ShowAll(R.string.chat_activity_show_log, log.hiddenLines.toInt()) { actions.openText(page) }
        }
        ActivityFormat.MARKDOWN -> {
            FormattedText(body.text, role = FormatRole.Quiet, limit = SHOWN_BLOCKS)
            if (FormatCache.blocks(body.text, false).size > SHOWN_BLOCKS) ShowAll(R.string.chat_activity_read_all, null) { actions.openText(page) }
        }
        ActivityFormat.TEXT -> {
            val clip = remember(body.text) { clipText(body.text, TEXT_LINES, ClipEnd.HEAD) }
            FormattedMessage(clip.text, role = FormatRole.Quiet)
            if (clip.hiddenLines > 0u) ShowAll(R.string.chat_activity_show_all, clip.hiddenLines.toInt()) { actions.openText(page) }
        }
    }
}

@Composable
internal fun ShowAll(words: Int, hidden: Int?, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(stringResource(words))
        if (hidden != null) {
            Text(
                " · " + pluralStringResource(R.plurals.chat_more_lines, hidden, hidden),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val ActivityKind.icon: Int
    get() = when (this) {
        ActivityKind.TASK -> R.drawable.ic_terminal
        ActivityKind.AGENT -> R.drawable.ic_account_tree
        ActivityKind.COMMAND -> R.drawable.ic_code_blocks
        ActivityKind.MESSAGE -> R.drawable.ic_info
    }

@Composable
private fun ActivityTone.color(): Color = when (this) {
    ActivityTone.PLAIN -> MaterialTheme.colorScheme.onSurfaceVariant
    ActivityTone.WORKING -> BroskiTheme.semantic.working
    ActivityTone.FAILED -> MaterialTheme.colorScheme.error
}
