package com.muzammil.broski.feature.chat.composer

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationEndReason
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.DecayAnimationSpec
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import uniffi.broski_contract.ModelSummary
import kotlin.math.roundToInt

private val WheelRow = 58.dp

/**
 * The sheet's models on a wheel. The row in the band is the one chosen, and it is chosen when the wheel
 * comes to rest; every row that passes the band ticks. The band's row shows its thinking level, and a
 * tap on it opens the level; a tap on another row turns the wheel to it. Under the wheel, what the
 * band's model is.
 */
@Composable
fun ModelWheel(
    models: List<ModelSummary>,
    chosen: String?,
    level: (ModelSummary) -> String?,
    settle: (ModelSummary) -> Unit,
    tapCentered: (ModelSummary) -> Unit,
    longPress: ((ModelSummary) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    val wheel = rememberWheel(models, chosen, settle)
    LaunchedEffect(wheel) {
        snapshotFlow { wheel.centered }.drop(1).collect { haptics.perform(Haptic.PickerStep) }
    }
    LaunchedEffect(models.size) { wheel.keepWithin(models.lastIndex) }

    Column(modifier.fillMaxWidth()) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(WheelRow * Drum.rows(models.size))
                .clipToBounds()
                .wheelGestures(wheel, haptics, tapCentered, longPress),
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.padding(horizontal = Grouped.margin).fillMaxWidth().height(WheelRow).clip(CircleShape).background(Grouped.card))
            models.forEachIndexed { index, model ->
                key(model.id) {
                    WheelRow(
                        model = model,
                        level = level(model),
                        isCentered = index == wheel.centered,
                        distance = { index - wheel.position.value },
                        rowPx = wheel.rowPx,
                        select = { if (index == wheel.centered) tapCentered(model) else wheel.restAt(index) },
                    )
                }
            }
        }
        val about = models.getOrNull(wheel.centered)?.let { about(it) }
        AnimatedContent(about, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "model about") { text ->
            Text(
                text.orEmpty(),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Grouped.margin + 24.dp, vertical = 12.dp),
            )
        }
    }
}

/**
 * Where the wheel stands, in rows, and how it moves: dragged with the finger, flung with a decay that
 * lands on a row, and sprung onto that row; reaching a row by any of them chooses it.
 */
private class Wheel(
    val position: Animatable<Float, AnimationVector1D>,
    val rowPx: Float,
    private val scope: CoroutineScope,
    private val decay: DecayAnimationSpec<Float>,
    private val rest: FiniteAnimationSpec<Float>,
    val models: () -> List<ModelSummary>,
    private val settle: (ModelSummary) -> Unit,
) {
    val centered: Int by derivedStateOf { position.value.roundToInt().coerceIn(0, models().lastIndex.coerceAtLeast(0)) }

    val isAtRest: Boolean get() = !position.isRunning && position.value == centered.toFloat()

    fun restAt(target: Int, velocity: Float = 0f) {
        scope.launch {
            val end = position.animateTo(target.toFloat(), rest, velocity)
            if (end.endReason == AnimationEndReason.Finished) models().getOrNull(target)?.let(settle)
        }
    }

    fun fling(velocity: Float) {
        val projected = decay.calculateTargetValue(position.value * rowPx, velocity * rowPx) / rowPx
        restAt(projected.roundToInt().coerceIn(0, models().lastIndex), velocity)
    }

    fun drag(byPx: Float) {
        val next = Drum.dragged(position.value, -byPx / rowPx, models().lastIndex)
        scope.launch { position.snapTo(next) }
    }

    fun hold() {
        if (position.isRunning) scope.launch { position.stop() }
    }

    /** The row shown at `y` px from the top of a wheel `height` px tall. */
    fun rowAt(y: Float, height: Float): Int =
        (position.value + Drum.under((y - height / 2f) / rowPx)).roundToInt().coerceIn(0, models().lastIndex)

    suspend fun keepWithin(last: Int) {
        if (position.value > last) position.snapTo(last.coerceAtLeast(0).toFloat())
    }
}

@Composable
private fun rememberWheel(models: List<ModelSummary>, chosen: String?, settle: (ModelSummary) -> Unit): Wheel {
    val scope = rememberCoroutineScope()
    val rowPx = with(LocalDensity.current) { WheelRow.toPx() }
    val decay = rememberSplineBasedDecay<Float>()
    val rest = MaterialTheme.motionScheme.defaultSpatialSpec<Float>()
    val latest by rememberUpdatedState(models)
    val onSettle by rememberUpdatedState(settle)
    return remember(rowPx, decay, rest) {
        val start = latest.indexOfFirst { it.id == chosen }.coerceAtLeast(0).toFloat()
        Wheel(Animatable(start), rowPx, scope, decay, rest, { latest }, { onSettle(it) })
    }
}

/** A vertical drag turns the wheel and a fling spins it; a tap stops it, turns it to a row or opens the band's. */
private fun Modifier.wheelGestures(
    wheel: Wheel,
    haptics: HapticFeedback,
    tapCentered: (ModelSummary) -> Unit,
    longPress: ((ModelSummary) -> Unit)?,
): Modifier =
    pointerInput(wheel) {
        val tracker = VelocityTracker()
        detectVerticalDragGestures(
            onDragStart = { tracker.resetTracking() },
            onDragEnd = { wheel.fling(-tracker.calculateVelocity().y / wheel.rowPx) },
            onDragCancel = { wheel.fling(0f) },
        ) { change, delta ->
            tracker.addPointerInputChange(change)
            change.consume()
            wheel.drag(delta)
        }
    }.pointerInput(wheel, longPress) {
        detectTapGestures(
            onPress = { wheel.hold() },
            onLongPress = longPress?.let { press ->
                { offset ->
                    val row = wheel.rowAt(offset.y, size.height.toFloat())
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    wheel.restAt(wheel.centered)
                    wheel.models().getOrNull(row)?.let(press)
                }
            },
        ) { offset ->
            val row = wheel.rowAt(offset.y, size.height.toFloat())
            if (row == wheel.centered && wheel.isAtRest) wheel.models().getOrNull(row)?.let(tapCentered) else wheel.restAt(row)
        }
    }

@Composable
private fun WheelRow(
    model: ModelSummary,
    level: String?,
    isCentered: Boolean,
    distance: () -> Float,
    rowPx: Float,
    select: () -> Unit,
) {
    val levels = model.thinking.options
    val levelIndex = levels.indexOfFirst { it.value == (level ?: model.thinking.defaultValue) }.takeIf { it >= 0 }
    val title = model.thinking.title(level)
    val opens = stringResource(R.string.composer_thinking)
    Row(
        Modifier
            .offset { IntOffset(0, (Drum.shown(distance()) * rowPx).roundToInt()) }
            .graphicsLayer {
                val d = distance()
                rotationX = -Drum.angle(d)
                cameraDistance = 40f * density
                alpha = Drum.alpha(d)
            }
            .fillMaxWidth()
            .height(WheelRow)
            .padding(horizontal = Grouped.margin + 24.dp)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                selected = isCentered
                if (isCentered && title != null) stateDescription = "$opens, $title"
                onClick { select(); true }
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val detail = Modifier.graphicsLayer { alpha = Drum.detailAlpha(distance()) }
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(
                model.pillName,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (levels.isNotEmpty()) {
                Spacer(Modifier.width(14.dp))
                LevelDots(levels.size, levelIndex, detail)
            }
        }
        if (levels.isNotEmpty()) {
            Row(detail.padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title ?: stringResource(R.string.composer_thinking_default),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
                Icon(
                    painterResource(R.drawable.ic_chevron_right),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

/** What the agent says about the model, else who serves it and how much it reads at once. */
private fun about(model: ModelSummary): String? =
    model.description?.takeIf { it.isNotBlank() }
        ?: listOfNotNull(model.provider, model.contextWindow?.let { "${tokens(it)} context" }).joinToString(" · ").ifEmpty { null }
