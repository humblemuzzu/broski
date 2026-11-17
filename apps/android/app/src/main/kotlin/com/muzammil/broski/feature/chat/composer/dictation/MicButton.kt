package com.muzammil.broski.feature.chat.composer.dictation

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.voice.DictationPhase

private val SIZE = 44.dp

/** How far left the finger slides before letting go cancels. */
private val CANCEL_DISTANCE = 70.dp

/**
 * The composer's mic. Touch and hold to talk, let go to insert, slide left to cancel; a tap starts a
 * recording that goes on by itself, and the button then turns into ✓, which inserts it. The
 * recording starts on touch down, so the first word is never lost to a long-press delay.
 */
@Composable
fun MicButton(
    phase: DictationPhase,
    enabled: Boolean,
    onPress: () -> Unit,
    onSlide: (cancelling: Boolean) -> Unit,
    onRelease: (heldMs: Long) -> Unit,
) {
    val press by rememberUpdatedState(onPress)
    val slide by rememberUpdatedState(onSlide)
    val release by rememberUpdatedState(onRelease)
    val cancelPx = with(LocalDensity.current) { CANCEL_DISTANCE.toPx() }
    val held = phase is DictationPhase.Recording && phase.held
    val hint = stringResource(R.string.dictation_dictate_hint)
    val scale by animateFloatAsState(if (held) 1.18f else 1f, label = "mic")
    val label = stringResource(
        when {
            phase is DictationPhase.Recording && !phase.held -> R.string.dictation_insert
            phase is DictationPhase.Recording -> R.string.dictation_recording
            phase == DictationPhase.Transcribing -> R.string.dictation_transcribing
            else -> R.string.dictation_dictate
        },
    )
    Box(
        Modifier
            .size(SIZE)
            .scale(scale)
            .clip(CircleShape)
            .background(container(phase))
            .semantics {
                role = Role.Button
                contentDescription = label
                if (enabled) {
                    onClick(label = hint.takeIf { phase == DictationPhase.Idle }) {
                        press()
                        release(0)
                        true
                    }
                }
            }
            .then(
                if (!enabled) {
                    Modifier
                } else {
                    Modifier.pointerInput(Unit) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            press()
                            var cancelling = false
                            var released = false
                            try {
                                while (true) {
                                    val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                                    if (!change.pressed) {
                                        change.consume()
                                        released = true
                                        release(change.uptimeMillis - down.uptimeMillis)
                                        break
                                    }
                                    val now = change.position.x - down.position.x < -cancelPx
                                    if (now != cancelling) {
                                        cancelling = now
                                        slide(now)
                                    }
                                    change.consume()
                                }
                            } finally {
                                // A gesture the system took away still ends: a held recording never outlives the finger.
                                if (!released) release(Long.MAX_VALUE)
                            }
                        }
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(face(phase), transitionSpec = { scaleIn() togetherWith scaleOut() }, label = "mic face") { face ->
            when (face) {
                Face.Working -> CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else -> Icon(
                    painterResource(face.icon),
                    contentDescription = null,
                    tint = if (face == Face.Idle) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (enabled) 1f else 0.38f) else Color.White,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
}

private enum class Face(val icon: Int) {
    Idle(R.drawable.ic_mic),
    Listening(R.drawable.ic_mic_fill1),
    Cancelling(R.drawable.ic_close),
    Insert(R.drawable.ic_check),
    Working(R.drawable.ic_mic),
}

private fun face(phase: DictationPhase): Face = when (phase) {
    is DictationPhase.Recording -> when {
        !phase.held -> Face.Insert
        phase.cancelling -> Face.Cancelling
        else -> Face.Listening
    }
    DictationPhase.Transcribing -> Face.Working
    else -> Face.Idle
}

@Composable
private fun container(phase: DictationPhase): Color = when (face(phase)) {
    Face.Listening -> MaterialTheme.colorScheme.error
    Face.Cancelling -> MaterialTheme.colorScheme.outline
    Face.Insert -> MaterialTheme.colorScheme.primary
    Face.Idle, Face.Working -> Color.Transparent
}
