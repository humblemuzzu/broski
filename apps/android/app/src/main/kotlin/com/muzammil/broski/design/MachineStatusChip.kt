package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.MachineHealth
import uniffi.broski_core.LinkRoute
import uniffi.broski_core.WaitReason

/** The plain sentence for a machine's health, naming the machine where the sentence needs it. */
@Composable
fun MachineHealth.label(machineName: String): String = when (this) {
    is MachineHealth.Online -> when (route) {
        LinkRoute.LAN -> stringResource(R.string.health_online_lan)
        LinkRoute.RELAY -> stringResource(R.string.health_online_relay)
        null -> stringResource(R.string.health_online)
    }
    MachineHealth.Connecting -> stringResource(R.string.health_connecting)
    is MachineHealth.Waiting -> when (reason) {
        WaitReason.RETRY -> stringResource(R.string.health_connecting)
        WaitReason.PAUSED -> stringResource(R.string.health_paused)
        WaitReason.MACHINE_OFFLINE -> stringResource(R.string.health_offline, machineName)
        WaitReason.MACHINE_ASLEEP -> stringResource(R.string.health_asleep, machineName)
        WaitReason.RELAY_REFUSED -> stringResource(R.string.health_relay_refused)
    }
    MachineHealth.BridgeStarting -> stringResource(R.string.health_bridge_starting, machineName)
    is MachineHealth.BridgeDown -> stringResource(R.string.health_bridge_down, machineName)
    is MachineHealth.Incompatible -> stringResource(R.string.health_incompatible, machineName)
    is MachineHealth.Refused -> stringResource(R.string.health_refused, machineName)
    MachineHealth.Revoked -> stringResource(R.string.health_revoked)
    MachineHealth.Ended -> stringResource(R.string.health_ended)
}

@get:DrawableRes
val MachineHealth.icon: Int
    get() = when (this) {
        is MachineHealth.Online -> if (route == LinkRoute.RELAY) R.drawable.ic_cloud else R.drawable.ic_wifi
        MachineHealth.Connecting, MachineHealth.BridgeStarting -> R.drawable.ic_sync
        is MachineHealth.Waiting -> when (reason) {
            WaitReason.MACHINE_OFFLINE -> R.drawable.ic_cloud_off
            WaitReason.MACHINE_ASLEEP -> R.drawable.ic_bedtime
            WaitReason.RELAY_REFUSED -> R.drawable.ic_block
            WaitReason.RETRY, WaitReason.PAUSED -> R.drawable.ic_sync
        }
        is MachineHealth.BridgeDown, is MachineHealth.Incompatible -> R.drawable.ic_warning
        is MachineHealth.Refused, MachineHealth.Revoked -> R.drawable.ic_block
        MachineHealth.Ended -> R.drawable.ic_link_off
    }

private enum class Severity { Fine, Passing, Broken }

private val MachineHealth.severity: Severity
    get() = when (this) {
        is MachineHealth.Online -> Severity.Fine
        MachineHealth.Connecting, MachineHealth.BridgeStarting, is MachineHealth.Waiting -> Severity.Passing
        else -> Severity.Broken
    }

/** A machine's health as a compact chip: icon and words, coloured by how serious it is. */
@Composable
fun MachineStatusChip(health: MachineHealth, machineName: String, modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val (container: Color, content: Color) = when (health.severity) {
        Severity.Fine -> colors.secondaryContainer to colors.onSecondaryContainer
        Severity.Passing -> colors.surfaceContainerHigh to colors.onSurface
        Severity.Broken -> colors.errorContainer to colors.onErrorContainer
    }
    Surface(modifier = modifier, shape = MaterialTheme.shapes.small, color = container, contentColor = content) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(painterResource(health.icon), contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(health.label(machineName), style = MaterialTheme.typography.labelLarge)
        }
    }
}
