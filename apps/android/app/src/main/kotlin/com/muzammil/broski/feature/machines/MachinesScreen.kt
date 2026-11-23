package com.muzammil.broski.feature.machines

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.settings.SettingsPage

/** Every paired Mac with its link, bridge and agents; pair another, restart a bridge that is down, forget a Mac. */
@Composable
fun MachinesScreen(phone: PhoneSession, onBack: () -> Unit, onPairAnother: () -> Unit) {
    val viewModel = viewModel { MachinesViewModel(phone) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current
    var forgetting by rememberSaveable { mutableStateOf<String?>(null) }
    var restartFailed by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.restartFailed.collect { id ->
            haptics.perform(Haptic.Failure)
            restartFailed = id
        }
    }

    SettingsPage(
        stringResource(R.string.machines_title),
        onBack,
        action = { GlassCircleButton(R.drawable.ic_add, stringResource(R.string.machines_pair_another), onPairAnother) },
        overlay = {
            if (state.machines.isEmpty() && state.unreadable.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    EmptyState(stringResource(R.string.machines_empty_title), stringResource(R.string.machines_empty_body))
                }
            }
        },
    ) {
        state.machines.forEach { machine ->
            machineSection(machine, onRestartBridge = { viewModel.restartBridge(machine.id) }, onForget = { forgetting = machine.id })
        }
        if (state.unreadable.isNotEmpty()) unreadableSection(state.unreadable) { forgetting = it }
    }

    forgetting?.let { id ->
        val name = state.machines.firstOrNull { it.id == id }?.name ?: stringResource(R.string.machines_unreadable_name)
        ForgetDialog(
            name = name,
            onForget = {
                haptics.perform(Haptic.Warning)
                viewModel.forget(id)
                forgetting = null
            },
            onDismiss = { forgetting = null },
        )
    }
    restartFailed?.let { id ->
        val name = state.machines.firstOrNull { it.id == id }?.name.orEmpty()
        AlertDialog(
            onDismissRequest = { restartFailed = null },
            title = { Text(stringResource(R.string.machines_restart_failed_title)) },
            text = { Text(stringResource(R.string.machines_restart_failed, name)) },
            confirmButton = { TextButton(onClick = { restartFailed = null }) { Text(stringResource(R.string.action_ok)) } },
        )
    }
}

@Composable
private fun ForgetDialog(name: String, onForget: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.machines_forget_title, name)) },
        text = { Text(stringResource(R.string.machines_forget_body, name)) },
        confirmButton = {
            TextButton(
                onClick = onForget,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(stringResource(R.string.machines_forget)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}
