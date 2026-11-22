package com.muzammil.broski.feature.chat.transcript

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.feature.chat.work.duration
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.shimmer
import kotlinx.coroutines.delay
import kotlin.math.ceil

/** The lane's height when it holds one line, kept while it is empty so nothing under it moves. */
val LaneHeight = 28.dp

/**
 * The one live line under the transcript: a thinking orb for what the session is doing, its words
 * swept by a shimmer, and how long the run has gone while the agent works rather than waits on the
 * person. Empty, it keeps its height.
 */
@Composable
fun StatusLaneView(status: LaneStatus?, runStartedAt: Long?, modifier: Modifier = Modifier) {
    val fade = MaterialTheme.motionScheme.fastEffectsSpec<Float>()
    Row(
        modifier.fillMaxWidth().heightIn(min = LaneHeight).semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Crossfade(status?.orb, animationSpec = fade, label = "lane orb") { orb ->
            if (orb != null) Orb(orb, Modifier.padding(end = 12.dp), size = 20.dp)
        }
        AnimatedContent(
            targetState = status,
            transitionSpec = { fadeIn(fade) togetherWith fadeOut(fade) },
            contentKey = { it?.let { status -> status::class } },
            label = "lane",
        ) { current ->
            if (current != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        laneWords(current),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 4.dp).shimmer(MaterialTheme.colorScheme.onSurface),
                    )
                    if (runStartedAt != null && current.orb != null) Elapsed(runStartedAt)
                }
            }
        }
    }
}

/** " · 2m", counting each second. */
@Composable
private fun Elapsed(since: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(since) {
        while (true) {
            now = System.currentTimeMillis()
            delay(SECOND - now % SECOND)
        }
    }
    Text(
        " · " + duration((now - since).coerceAtLeast(0)),
        style = MaterialTheme.typography.labelLarge.copy(fontFeatureSettings = "tnum"),
        color = MaterialTheme.colorScheme.outline,
    )
}

@Composable
private fun laneWords(status: LaneStatus): String = when (status) {
    LaneStatus.Starting -> stringResource(R.string.chat_lane_starting)
    LaneStatus.Working -> stringResource(R.string.chat_lane_working)
    LaneStatus.Thinking -> stringResource(R.string.chat_lane_thinking)
    LaneStatus.WaitingForApproval -> stringResource(R.string.chat_lane_waiting_approval)
    LaneStatus.WaitingForAnswer -> stringResource(R.string.chat_lane_waiting_answer)
    LaneStatus.Compacting -> stringResource(R.string.chat_lane_compacting)
    is LaneStatus.Retrying -> retrying(status.retryAt)
}

@Composable
private fun retrying(retryAt: Long?): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(retryAt) {
        while (retryAt != null && now < retryAt) {
            delay(SECOND)
            now = System.currentTimeMillis()
        }
    }
    val seconds = retryAt?.let { ceil((it - now) / SECOND.toDouble()).toInt() }?.takeIf { it > 0 }
    return if (seconds == null) stringResource(R.string.chat_lane_retrying) else stringResource(R.string.chat_lane_retrying_in, seconds)
}

private const val SECOND = 1_000L
