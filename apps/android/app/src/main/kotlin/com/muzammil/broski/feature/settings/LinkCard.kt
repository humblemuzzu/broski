package com.muzammil.broski.feature.settings

import android.os.SystemClock
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.muzammil.broski.R
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.label
import com.muzammil.broski.design.settling
import com.muzammil.broski.design.IosText
import com.muzammil.broski.feature.usage.NumericText
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import uniffi.broski_core.LinkRoute

/** How long a round trip may take before it counts as missed. */
private const val PATIENCE_MS = 4_000L
private const val INTERVAL_MS = 1_000L

/** Kept for the widest strip; a narrower one shows the newest that fit. */
private const val KEPT = 64

/** The reasons an `info` request got no answer from the bridge; any other failure is the bridge's own answer. */
private val Unanswered = setOf(
    WorkspaceFailure.Reason.Timeout,
    WorkspaceFailure.Reason.Offline,
    WorkspaceFailure.Reason.TooMany,
    WorkspaceFailure.Reason.Incompatible,
)

/**
 * A paired Mac as a live link: a wave of capsules, one per round trip to its bridge, each reaching
 * out from the centre line as far as that trip was slow, sliding left as new ones grow in at the right
 * and fading as they age; under it the Mac, the last round trip in milliseconds, and how the phone
 * reaches it. A trip that does not come back in time is a dot in the caution colour. It measures
 * only while the screen is resumed, and only while the Mac is ready.
 */
@Composable
fun LinkCard(machine: MachineState, phone: PhoneSession, index: Int, count: Int, onClick: () -> Unit) {
    val ready = machine.health.isOnline
    val resumed = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value.isAtLeast(Lifecycle.State.RESUMED)
    var beats by remember(machine.id) { mutableStateOf(emptyList<Beat>()) }
    val client = remember(machine.id, phone) { phone.machine(machine.id)?.let { WorkspaceClient(it::request) } }
    LaunchedEffect(machine.id, client, ready, resumed) {
        if (!ready || !resumed || client == null) return@LaunchedEffect
        while (true) {
            val ms = roundTrip(client)
            beats = (beats + Beat((beats.lastOrNull()?.id ?: 0) + 1, ms)).takeLast(KEPT)
            delay(INTERVAL_MS)
        }
    }
    val latest = beats.lastOrNull()?.ms
    val route = routeText(machine, phone, beats.size)
    val trip = if (ready) latest?.roundToInt() else null
    val description = if (trip != null) {
        stringResource(R.string.link_description_trip, machine.name, route, trip)
    } else {
        stringResource(R.string.link_description, machine.name, route)
    }
    GroupedCardRow(index, count, onClick) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp).semantics(mergeDescendants = true) { contentDescription = description },
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            LinkStrip(beats, isLive = ready, Modifier.fillMaxWidth().height(56.dp))
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Header(machine.name, trip)
                RouteLine(machine.health, route)
            }
        }
    }
}

@Composable
private fun Header(name: String, trip: Int?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(name, style = IosText.body, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (trip != null) {
            NumericText(stringResource(R.string.link_ms, trip), IosText.subheadline.merge(IosText.tabular).copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
private fun RouteLine(health: MachineHealth, route: String) {
    val ready = health.isOnline
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(7.dp).background(health.dot(), CircleShape))
        Text(
            route,
            style = IosText.subheadline,
            color = if (ready) MaterialTheme.colorScheme.onSurfaceVariant else BroskiTheme.semantic.caution,
            maxLines = 1,
            overflow = TextOverflow.MiddleEllipsis,
        )
    }
}

/** "On this network · 192.168.1.20:18275", "Through the relay", or what is wrong. */
@Composable
private fun routeText(machine: MachineState, phone: PhoneSession, beatCount: Int): String {
    val health = machine.health
    if (health !is MachineHealth.Online) return health.label(machine.name)
    val detail = remember(machine.id, health, beatCount) { phone.machine(machine.id)?.status()?.link?.routeDetail }
    val way = stringResource(if (health.route == LinkRoute.LAN) R.string.link_route_lan else R.string.link_route_relay)
    return if (detail == null) way else stringResource(R.string.link_route_join, way, detail)
}

@Composable
internal fun MachineHealth.dot(): Color = when {
    isOnline -> BroskiTheme.semantic.done
    settling -> MaterialTheme.colorScheme.onSurfaceVariant
    this is MachineHealth.Revoked || this is MachineHealth.Refused -> MaterialTheme.colorScheme.error
    else -> BroskiTheme.semantic.caution
}

/** From the phone to the Mac's bridge and back: the smallest question the bridge answers itself. */
private suspend fun roundTrip(client: WorkspaceClient): Double? = withTimeoutOrNull(PATIENCE_MS) {
    val start = SystemClock.elapsedRealtimeNanos()
    val answer = client.info()
    if (answer is Answer.Failed && answer.failure.reason in Unanswered) null else (SystemClock.elapsedRealtimeNanos() - start) / 1e6
}
