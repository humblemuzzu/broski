package com.muzammil.broski.feature.newsession

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.displayName
import com.muzammil.broski.design.perform
import uniffi.broski_contract.AuthState
import uniffi.broski_contract.BackendId

/**
 * The agents the machine has, as chips; one that cannot run now is disabled, with why and what to
 * do about it under the row, in the backend's own words where it gave some.
 */
@Composable
internal fun AgentPicker(agents: List<AgentInstall>, selected: BackendId?, machineName: String, onPick: (BackendId) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            agents.forEach { agent ->
                FilterChip(
                    selected = agent.backend == selected,
                    enabled = agent.status?.usable == true,
                    onClick = {
                        haptics.perform(Haptic.PickerStep)
                        onPick(agent.backend)
                    },
                    leadingIcon = { AgentMark(agent.backend, size = 24.dp) },
                    label = { Text(stringResource(agent.backend.displayName)) },
                )
            }
        }
        agents.filter { it.status?.usable != true }.forEach { agent ->
            Text(
                unusable(agent, machineName),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun unusable(agent: AgentInstall, machineName: String): String {
    val name = stringResource(agent.backend.displayName)
    val status = agent.status ?: return stringResource(R.string.new_session_agent_checking, name)
    status.issues.firstOrNull()?.let { return stringResource(R.string.new_session_agent_issue, name, it.message) }
    return when {
        !status.installed -> stringResource(R.string.new_session_agent_missing, name, machineName)
        status.auth == AuthState.SIGNED_OUT -> stringResource(R.string.new_session_agent_signed_out, name, machineName)
        else -> stringResource(R.string.new_session_agent_cannot_run, name)
    }
}
