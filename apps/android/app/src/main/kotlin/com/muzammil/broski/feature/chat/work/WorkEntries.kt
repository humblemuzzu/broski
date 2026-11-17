package com.muzammil.broski.feature.chat.work

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.format.tools.ToolLinks
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.ToolDisplay
import uniffi.broski_contract.ToolOutcome
import uniffi.broski_core.ToolKind

/** Where a row of work leads: a file change's diff, a subagent's own session, the whole of a long text, a file. */
@Immutable
class WorkActions(
    val openDiff: (FileChange) -> Unit,
    val openSession: (SessionRef) -> Unit,
    val openText: (TextPage) -> Unit,
    val openFile: (String) -> Unit,
    /** A file at a line, as a path in agent text or a search row opens it. */
    val openFileAt: (String, Int?) -> Unit = { path, _ -> openFile(path) },
) {
    /** What a tool's result opens, for the formatter's tool views. */
    val toolLinks = ToolLinks(
        openFile = openFileAt,
        openReport = { title, text -> openText(TextPage(title, text, TextPage.Format.MARKDOWN)) },
        openLog = { title, text -> openText(TextPage(title, text, TextPage.Format.LOG)) },
    )
}

/** other clients's numbers: an open fold stops at 256 dp and scrolls inside, under 12 dp edge fades. */
private val MAX_HEIGHT = 256.dp
private val ROW_HEIGHT = 28.dp
private val FADE = 12.dp

@Composable
internal fun WorkEntries(
    entries: List<WorkEntry>,
    expanded: (String) -> Boolean,
    onToggle: (String) -> Unit,
    actions: WorkActions,
) {
    val scroll = rememberScrollState()
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 8.dp),
    ) {
        Column(
            Modifier
                .heightIn(max = MAX_HEIGHT)
                .edgeFades(scroll)
                .verticalScroll(scroll)
                .padding(vertical = 6.dp),
        ) {
            entries.forEach { entry ->
                EntryRow(entry, expanded(entry.id), { onToggle(entry.id) }, actions)
            }
        }
    }
}

@Composable
private fun EntryRow(entry: WorkEntry, expanded: Boolean, onToggle: () -> Unit, actions: WorkActions) {
    val haptics = LocalHapticFeedback.current
    val stateWords = stringResource(if (expanded) R.string.chat_work_expanded else R.string.chat_work_collapsed)
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_HEIGHT)
                .clickable {
                    haptics.perform(if (expanded) Haptic.Collapse else Haptic.Expand)
                    onToggle()
                }
                .semantics { stateDescription = stateWords }
                .padding(start = if (entry is WorkEntry.Tool && entry.nested) 28.dp else 12.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(painterResource(entry.icon), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
            Text(
                entryLabel(entry, expanded),
                style = MaterialTheme.typography.bodySmall.let { if (!expanded && entry is WorkEntry.Tool && entry.kind == ToolKind.COMMAND) it.mono() else it },
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (entry is WorkEntry.Tool) Outcome(entry)
        }
        if (expanded) EntryDetail(entry, actions)
    }
}

@Composable
private fun entryLabel(entry: WorkEntry, expanded: Boolean): String = when (entry) {
    is WorkEntry.Tool -> if (expanded) entry.look.verb else entry.label
    is WorkEntry.Thought -> stringResource(if (entry.live) R.string.chat_work_thinking else R.string.chat_work_thought)
    is WorkEntry.Aside -> entry.text.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty()
}

/** How a call ended, in a word, when it did not simply complete; a running call shows nothing, the lane is alive. */
@Composable
private fun Outcome(tool: WorkEntry.Tool) {
    val words = when {
        tool.exitCode != null && tool.exitCode != 0L -> stringResource(R.string.chat_work_exit, tool.exitCode)
        tool.outcome == ToolOutcome.FAILED -> stringResource(R.string.chat_work_outcome_failed)
        tool.outcome == ToolOutcome.DENIED -> stringResource(R.string.chat_work_outcome_denied)
        tool.outcome == ToolOutcome.ABORTED -> stringResource(R.string.chat_work_outcome_stopped)
        else -> return
    }
    val error = tool.failed
    Surface(
        shape = MaterialTheme.shapes.small,
        color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor = if (error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Text(words, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
    }
}

private val WorkEntry.icon: Int
    get() = when (this) {
        is WorkEntry.Thought -> R.drawable.ic_psychology
        is WorkEntry.Aside -> R.drawable.ic_account_tree
        is WorkEntry.Tool -> if (display is ToolDisplay.Todos) R.drawable.ic_check_circle else when (kind) {
            ToolKind.READ -> R.drawable.ic_description
            ToolKind.EDIT -> R.drawable.ic_edit_note
            ToolKind.COMMAND -> R.drawable.ic_terminal
            ToolKind.SEARCH -> R.drawable.ic_search
            ToolKind.WEB -> R.drawable.ic_language
            ToolKind.AGENT -> R.drawable.ic_account_tree
            ToolKind.OTHER -> R.drawable.ic_build
        }
    }

/** Top and bottom fade to nothing where the capped rows go on under the edge. */
private fun Modifier.edgeFades(scroll: ScrollState): Modifier = graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
    .drawWithContent {
        drawContent()
        val fade = FADE.toPx()
        if (scroll.value > 0) {
            drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black), 0f, fade), blendMode = BlendMode.DstIn, size = size.copy(height = fade))
        }
        if (scroll.value < scroll.maxValue) {
            drawRect(
                Brush.verticalGradient(listOf(Color.Black, Color.Transparent), size.height - fade, size.height),
                topLeft = Offset(0f, size.height - fade),
                size = size.copy(height = fade),
                blendMode = BlendMode.DstIn,
            )
        }
    }
