package com.muzammil.broski.feature.machines

import android.text.format.DateFormat
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.label
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.relativeTime
import com.muzammil.broski.design.settling
import com.muzammil.broski.feature.settings.FormButtonRow
import com.muzammil.broski.feature.settings.FormFooter
import com.muzammil.broski.feature.settings.FormHeader
import com.muzammil.broski.feature.settings.FormRow
import com.muzammil.broski.feature.settings.FormValueRow
import com.muzammil.broski.design.IosText
import java.text.SimpleDateFormat
import java.util.Date
import uniffi.broski_contract.AuthState
import uniffi.broski_core.LinkRoute

/**
 * One paired Mac as iOS lists it: its name over a card that says how it is connected or why it is
 * not, when it was last seen, its bridge and each agent, a restart for a bridge that is down, and
 * forgetting it; the day it was paired under the card.
 */
fun LazyListScope.machineSection(machine: MachineState, onRestartBridge: () -> Unit, onForget: () -> Unit) {
    item(key = machine.id) {
        val lastSeen = machine.lastSeenMs.takeIf { !machine.health.isOnline }
        val restart = machine.health is MachineHealth.BridgeDown
        val count = 2 + listOfNotNull(lastSeen, machine.bridgeVersion).size + machine.agents.size + if (restart) 1 else 0
        var index = 0
        FormHeader(machine.name)
        FormRow(index++, count) {
            StatusIcon(machine.health)
            Text(machine.health.label(machine.name), style = IosText.body, modifier = Modifier.weight(1f))
        }
        lastSeen?.let { FormValueRow(index++, count, stringResource(R.string.machines_last_seen_label), relativeTime(it)) }
        machine.bridgeVersion?.let { FormValueRow(index++, count, stringResource(R.string.machines_bridge), it) }
        machine.agents.forEach { FormValueRow(index++, count, it.agent.name, agentStatus(it)) }
        if (restart) {
            FormButtonRow(index++, count, stringResource(R.string.machines_restart_bridge), onRestartBridge, leading = {
                Icon(painterResource(R.drawable.ic_restart_alt), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            })
        }
        FormButtonRow(index, count, stringResource(R.string.machines_forget_named, machine.name), onForget, destructive = true)
        FormFooter(stringResource(R.string.machines_paired, pairedDay(machine.pairedAtMs)))
    }
}

@Composable
private fun StatusIcon(health: MachineHealth) {
    if (health.settling) {
        Orb(OrbState.CONNECTING, size = 22.dp)
        return
    }
    val (icon, tint) = when (health) {
        is MachineHealth.Online -> (if (health.route == LinkRoute.RELAY) R.drawable.ic_language else R.drawable.ic_wifi) to BroskiTheme.semantic.done
        MachineHealth.Revoked, MachineHealth.Ended -> R.drawable.ic_block to MaterialTheme.colorScheme.error
        else -> R.drawable.ic_warning to BroskiTheme.semantic.caution
    }
    Icon(painterResource(icon), contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
}

@Composable
private fun agentStatus(agent: AgentInstall): String {
    val status = agent.status ?: return stringResource(R.string.machines_agent_checking)
    return when {
        !status.installed -> stringResource(R.string.machines_agent_not_installed)
        !status.usable -> status.issues.firstOrNull()?.message ?: stringResource(R.string.machines_agent_unusable)
        status.auth == AuthState.SIGNED_OUT -> stringResource(R.string.machines_agent_signed_out)
        else -> status.version ?: stringResource(R.string.machines_agent_installed)
    }
}

@Composable
private fun pairedDay(epochMs: Long): String {
    val locale = LocalConfiguration.current.locales[0]
    return SimpleDateFormat(DateFormat.getBestDateTimePattern(locale, "dMMMyyyy"), locale).format(Date(epochMs))
}

/** The pairings this phone can no longer read, each with its short id and a way to forget it. */
fun LazyListScope.unreadableSection(ids: List<String>, onForget: (String) -> Unit) {
    item(key = "unreadable") {
        FormHeader(stringResource(R.string.machines_unreadable_header))
        ids.forEachIndexed { index, id ->
            FormRow(index, ids.size) {
                Text(
                    id.take(8),
                    style = MaterialTheme.typography.bodyMedium.mono(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                FormForget { onForget(id) }
            }
        }
        FormFooter(stringResource(R.string.machines_unreadable_body))
    }
}

@Composable
private fun FormForget(onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(stringResource(R.string.machines_forget), style = IosText.body, color = MaterialTheme.colorScheme.error)
    }
}
