package com.muzammil.broski.feature.chat.composer.dictation

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.voice.Dictation
import com.muzammil.broski.core.voice.DictationPhase
import com.muzammil.broski.core.voice.DictationProblem
import com.muzammil.broski.core.voice.DictationState
import com.muzammil.broski.design.shimmer
import kotlinx.coroutines.delay

/**
 * What takes the field's place while dictating: the live waveform and time, then "Transcribing…",
 * or why it failed with what to do.
 */
@Composable
fun RecordingBar(state: DictationState, phase: DictationPhase, dictation: Dictation, openVoiceSettings: (() -> Unit)?, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        when (phase) {
            is DictationPhase.Recording -> Recording(state, phase)
            DictationPhase.Transcribing -> Text(
                stringResource(R.string.dictation_transcribing),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.heightIn(min = 28.dp).shimmer(MaterialTheme.colorScheme.onSurface),
            )
            is DictationPhase.Failed -> Failure(phase.problem, dictation, openVoiceSettings)
            DictationPhase.Idle -> Unit
        }
    }
}

@Composable
private fun Recording(state: DictationState, phase: DictationPhase.Recording) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            RecordingDot()
            Elapsed(state.startedAtMs ?: System.currentTimeMillis())
            Waveform(state.levels, dimmed = phase.cancelling, modifier = Modifier.weight(1f).height(26.dp))
        }
        Text(
            stringResource(
                when {
                    phase.cancelling -> R.string.dictation_hint_cancelling
                    phase.held -> R.string.dictation_hint_held
                    else -> R.string.dictation_hint_locked
                },
            ),
            style = MaterialTheme.typography.bodySmall,
            color = if (phase.cancelling) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun RecordingDot() {
    val pulse = rememberInfiniteTransition(label = "dot")
    val alpha by pulse.animateFloat(1f, 0.35f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "dot alpha")
    Box(Modifier.size(9.dp).alpha(alpha).background(MaterialTheme.colorScheme.error, CircleShape))
}

@Composable
private fun Elapsed(startedAtMs: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(startedAtMs) {
        while (true) {
            now = System.currentTimeMillis()
            delay(500)
        }
    }
    val seconds = ((now - startedAtMs) / 1000).coerceAtLeast(0)
    Text(
        "%d:%02d".format(seconds / 60, seconds % 60),
        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The last few seconds' loudness as bars, newest at the right. */
@Composable
private fun Waveform(levels: List<Float>, dimmed: Boolean, modifier: Modifier) {
    val color = if (dimmed) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.primary
    Canvas(modifier) {
        val count = Dictation.LEVELS
        val gap = 2.dp.toPx()
        val width = ((size.width - gap * (count - 1)) / count).coerceAtLeast(1f)
        val padded = List((count - levels.size).coerceAtLeast(0)) { 0f } + levels.takeLast(count)
        padded.forEachIndexed { index, level ->
            val height = (level * size.height).coerceAtLeast(3.dp.toPx())
            drawRoundRect(
                color = color,
                topLeft = Offset(index * (width + gap), (size.height - height) / 2),
                size = Size(width, height),
                cornerRadius = CornerRadius(width / 2),
            )
        }
    }
}

@Composable
private fun Failure(problem: DictationProblem, dictation: Dictation, openVoiceSettings: (() -> Unit)?) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(painterResource(R.drawable.ic_warning), contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
            Text(stringResource(problem.message), style = MaterialTheme.typography.bodyMedium)
        }
        problem.detail?.takeIf { it.isNotBlank() }?.let { detail ->
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val fix: Pair<Int, () -> Unit>? = when (problem.fix) {
                DictationProblem.Fix.Retry -> R.string.dictation_try_again to dictation::retry
                DictationProblem.Fix.VoiceSettings -> openVoiceSettings?.let { open -> R.string.dictation_voice_settings to { dictation.discard(); open() } }
                DictationProblem.Fix.SystemSettings -> R.string.dictation_open_settings to {
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
                }
                DictationProblem.Fix.None -> null
            }
            fix?.let { (label, action) -> Button(onClick = action) { Text(stringResource(label)) } }
            OutlinedButton(onClick = dictation::discard) {
                Text(stringResource(if (fix == null) R.string.dictation_ok else R.string.dictation_discard))
            }
        }
    }
}
