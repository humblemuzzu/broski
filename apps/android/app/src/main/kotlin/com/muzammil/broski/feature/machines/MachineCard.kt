package com.muzammil.broski.feature.machines

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.MachineStatusChip
import com.muzammil.broski.design.displayName
import com.muzammil.broski.design.relativeTime

@Composable
internal fun MachineCard(machine: MachineState, onRestartBridge: () -> Unit, onForget: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_computer), contentDescription = null)
                Text(
                    machine.name,
                    style = MaterialTheme.typography.titleLargeEmphasized,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
            }
            MachineStatusChip(machine.health, machine.name)
            MachineFacts(machine)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (machine.health is MachineHealth.BridgeDown) {
                    FilledTonalButton(onClick = onRestartBridge, shapes = ButtonDefaults.shapes()) {
                        Icon(painterResource(R.drawable.ic_restart_alt), contentDescription = null)
                        Text(stringResource(R.string.machines_restart_bridge), Modifier.padding(start = 8.dp))
                    }
                }
                TextButton(
                    onClick = onForget,
                    shapes = ButtonDefaults.shapes(),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    Icon(painterResource(R.drawable.ic_link_off), contentDescription = null)
                    Text(stringResource(R.string.machines_forget), Modifier.padding(start = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun MachineFacts(machine: MachineState) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        val lastSeen = machine.lastSeenMs
        if (!machine.health.isOnline && lastSeen != null) {
            Fact(stringResource(R.string.machines_last_seen, relativeTime(lastSeen)))
        }
        machine.bridgeVersion?.let { Fact(stringResource(R.string.machines_bridge_version, it)) }
        if (machine.agents.isNotEmpty()) {
            Fact(machine.agents.map { agentLine(it) }.joinToString(" · "))
        }
        Fact(stringResource(R.string.machines_paired, relativeTime(machine.pairedAtMs)))
    }
}

@Composable
private fun agentLine(agent: AgentInstall): String {
    val name = stringResource(agent.backend.displayName)
    val status = agent.status ?: return name
    return when {
        !status.installed -> stringResource(R.string.machines_agent_not_installed, name)
        status.version != null -> stringResource(R.string.machines_agent_installed, name, status.version.orEmpty())
        else -> name
    }
}

@Composable
private fun Fact(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
