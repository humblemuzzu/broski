package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** One button a swipe reveals: its symbol on its colour, the label for TalkBack. */
@Immutable
class SwipeAction(
    val label: String,
    @param:DrawableRes val icon: Int,
    val tint: Color,
    val enabled: Boolean = true,
    val onClick: () -> Unit,
)

private val BUTTON_WIDTH = 74.dp

/** What a drag needs to remember between frames: the row's width and whether it is past the full-swipe line. */
private class SwipeMemory {
    var width = 0f
    var crossed = false
}

/**
 * A row with iOS's swipe actions: dragged toward the end it uncovers [leading] at its start, toward
 * the start [trailing] at its end, the buttons sharing what the drag uncovers; a release past half
 * opens them to 74 dp each, a tap on one does it and closes. Dragged right across most of the row it
 * does the first leading action at once, when [fullSwipeLeading], with a tick as it crosses.
 */
@Composable
fun SwipeActions(
    leading: List<SwipeAction>,
    trailing: List<SwipeAction>,
    modifier: Modifier = Modifier,
    fullSwipeLeading: Boolean = true,
    content: @Composable () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val button = with(LocalDensity.current) { BUTTON_WIDTH.toPx() }
    val openStart = button * leading.size
    val openEnd = -button * trailing.size
    val offset = remember { Animatable(0f) }
    val memory = remember { SwipeMemory() }
    val settle = { to: Float -> scope.launch { offset.animateTo(to, spring(dampingRatio = 0.86f, stiffness = 520f)) } }
    val close = { settle(0f) }
    val drag = rememberDraggableState { delta ->
        val next = (offset.value + delta).coerceIn(if (trailing.isEmpty()) 0f else openEnd * 1.3f, if (leading.isEmpty()) 0f else memory.width)
        val full = fullSwipeLeading && leading.isNotEmpty() && next > memory.width * 0.6f
        if (full != memory.crossed) {
            memory.crossed = full
            haptics.perform(Haptic.PickerStep)
        }
        scope.launch { offset.snapTo(next) }
    }
    Box(
        modifier
            .onSizeChanged { memory.width = it.width.toFloat() }
            .draggable(
                drag,
                Orientation.Horizontal,
                enabled = leading.isNotEmpty() || trailing.isNotEmpty(),
                onDragStopped = {
                    val at = offset.value
                    when {
                        memory.crossed -> {
                            memory.crossed = false
                            leading.first().takeIf { it.enabled }?.onClick?.invoke()
                            close()
                        }
                        at > openStart / 2 -> settle(openStart)
                        at < openEnd / 2 -> settle(openEnd)
                        else -> close()
                    }
                },
            ),
    ) {
        val uncovered = with(LocalDensity.current) { abs(offset.value).toDp() }
        if (offset.value > 0f) {
            Uncovered(Modifier.matchParentSize(), Alignment.CenterStart) {
                Row(Modifier.width(uncovered).fillMaxHeight()) { leading.forEach { ActionButton(it) { it.onClick(); close() } } }
            }
        } else if (offset.value < 0f) {
            Uncovered(Modifier.matchParentSize(), Alignment.CenterEnd) {
                Row(Modifier.width(uncovered).fillMaxHeight()) { trailing.forEach { ActionButton(it) { it.onClick(); close() } } }
            }
        }
        Box(Modifier.offset { IntOffset(offset.value.roundToInt(), 0) }) {
            content()
            if (offset.value != 0f) Box(Modifier.matchParentSize().clickable(onClick = { close() }))
        }
    }
}

@Composable
private fun Uncovered(modifier: Modifier, alignment: Alignment, content: @Composable () -> Unit) {
    Box(modifier, contentAlignment = alignment) { content() }
}

@Composable
private fun RowScope.ActionButton(action: SwipeAction, onClick: () -> Unit) {
    Box(
        Modifier
            .weight(1f)
            .fillMaxHeight()
            .background(action.tint)
            .clickable(enabled = action.enabled, role = Role.Button, onClickLabel = action.label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(action.icon), contentDescription = action.label, tint = Color.White, modifier = Modifier.size(22.dp))
    }
}
