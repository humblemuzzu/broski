package com.muzammil.broski.feature.workspace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.MachineStatusChip
import uniffi.broski_core.Machine

/**
 * Shows [content] once the machine is online, and keeps it through a later reconnect (requests
 * wait for the link; a banner says why). Before that, the machine's status, so nothing is sent to a
 * Mac that cannot answer.
 */
@Composable
fun MachineGate(
    phone: PhoneSession,
    machineId: String,
    modifier: Modifier = Modifier,
    content: @Composable (machine: Machine, state: MachineState) -> Unit,
) {
    val machines by phone.machines.collectAsStateWithLifecycle()
    val state = machines.firstOrNull { it.id == machineId }
    val machine = phone.machine(machineId)
    var reached by rememberSaveable(machineId) { mutableStateOf(false) }
    LaunchedEffect(state?.health) {
        if (state?.health?.isOnline == true) reached = true
    }
    when {
        state == null || machine == null -> EmptyState(
            title = stringResource(R.string.workspace_not_paired_title),
            body = stringResource(R.string.workspace_not_paired_body),
            modifier = modifier,
        )
        reached || state.health.isOnline -> content(machine, state)
        else -> MachineWaiting(state, modifier)
    }
}

@Composable
private fun MachineWaiting(state: MachineState, modifier: Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        MachineStatusChip(state.health, state.name)
        Text(
            stringResource(R.string.workspace_waiting_body, state.name),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The machine's status over a screen that already shows its content, while it is not online. */
@Composable
fun MachineBanner(state: MachineState, modifier: Modifier = Modifier) {
    if (!state.health.isOnline) {
        MachineStatusChip(state.health, state.name, modifier.padding(horizontal = 16.dp, vertical = 8.dp))
    }
}
