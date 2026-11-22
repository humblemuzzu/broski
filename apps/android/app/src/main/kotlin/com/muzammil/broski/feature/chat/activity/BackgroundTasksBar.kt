package com.muzammil.broski.feature.chat.activity

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.format.agentLine
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.work.duration
import kotlinx.coroutines.delay
import uniffi.broski_contract.BackgroundTask
import uniffi.broski_contract.BackgroundTaskKind

private val LIST_MAX = 220.dp
private val CLOSE_DRAG = 24.dp

/**
 * Work the agent left running in the background: a small pill above the composer saying what runs,
 * which opens in place to each task, its command and how long it has run. The whole header of the
 * open card folds it again, and so does a swipe down. Each task's end shows in the transcript as an
 * activity.
 */
@Composable
fun BackgroundTasksBar(tasks: List<BackgroundTask>, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    var open by rememberSaveable { mutableStateOf(false) }
    val toggle = {
        haptics.perform(if (open) Haptic.Collapse else Haptic.Expand)
        open = !open
    }
    AnimatedContent(open, modifier, label = "background tasks") { shown ->
        if (shown) TaskList(tasks, onClose = toggle) else Pill(tasks, onOpen = toggle)
    }
}

@Composable
private fun Pill(tasks: List<BackgroundTask>, onOpen: () -> Unit) {
    val summary = if (tasks.size == 1) agentLine(tasks.first().title) else pluralStringResource(R.plurals.chat_background_tasks, tasks.size, tasks.size)
    Row {
        Surface(onClick = onOpen, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Row(
                Modifier.heightIn(min = 34.dp).padding(start = 10.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Orb(OrbState.WORKING, size = 16.dp)
                Text(summary, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Icon(
                    painterResource(R.drawable.ic_keyboard_arrow_up),
                    contentDescription = stringResource(R.string.chat_background_show),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun TaskList(tasks: List<BackgroundTask>, onClose: () -> Unit) {
    val closeAt = with(LocalDensity.current) { CLOSE_DRAG.toPx() }
    var dragged by remember { mutableFloatStateOf(0f) }
    Surface(
        shape = RoundedCornerShape(24.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().draggable(
            state = rememberDraggableState { delta -> dragged += delta },
            orientation = Orientation.Vertical,
            onDragStopped = {
                if (dragged > closeAt) onClose()
                dragged = 0f
            },
        ),
    ) {
        Column(Modifier.padding(bottom = 12.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClickLabel = stringResource(R.string.chat_background_hide), role = Role.Button, onClick = onClose)
                    .heightIn(min = 44.dp)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Orb(OrbState.WORKING, size = 16.dp)
                Text(
                    stringResource(R.string.chat_background_title),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                Icon(
                    painterResource(R.drawable.ic_keyboard_arrow_down),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
            }
            Column(
                Modifier.heightIn(max = LIST_MAX).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                tasks.forEach { TaskRow(it) }
            }
        }
    }
}

@Composable
private fun TaskRow(task: BackgroundTask) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(
            painterResource(if (task.kind == BackgroundTaskKind.AGENT) R.drawable.ic_account_tree else R.drawable.ic_terminal),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(agentLine(task.title), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            task.command?.takeIf { it.isNotEmpty() && it != task.title }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall.mono(), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        task.startedAt?.let { Elapsed(it) }
    }
}

/** How long the task has run, ticking once a second while it is on screen. */
@Composable
private fun Elapsed(since: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(since) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    Text(
        duration((now - since).coerceAtLeast(0)),
        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
        color = MaterialTheme.colorScheme.outline,
    )
}
