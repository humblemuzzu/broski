package com.muzammil.broski.feature.machines

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.Notice
import com.muzammil.broski.design.QuietButton
import com.muzammil.broski.design.perform

/** Each paired Mac with its status, and the actions on it: restart its bridge, forget it, pair another. */
@Composable
fun MachinesScreen(phone: PhoneSession, onBack: () -> Unit, onPairAnother: () -> Unit) {
    val viewModel = viewModel { MachinesViewModel(phone) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val haptics = LocalHapticFeedback.current
    val resources = LocalResources.current
    val snackbar = remember { SnackbarHostState() }
    var forgetting by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(viewModel) {
        viewModel.restartFailed.collect {
            haptics.perform(Haptic.Failure)
            snackbar.showSnackbar(resources.getString(R.string.machines_restart_failed))
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.machines_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = onPairAnother,
                icon = { Icon(painterResource(R.drawable.ic_qr_code_scanner), contentDescription = null) },
                text = { Text(stringResource(R.string.machines_pair_another)) },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        MachinesList(state, padding, onRestartBridge = viewModel::restartBridge, onForget = { forgetting = it })
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
}

@Composable
private fun MachinesList(
    state: MachinesUiState,
    padding: PaddingValues,
    onRestartBridge: (String) -> Unit,
    onForget: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = padding.calculateTopPadding() + 8.dp,
            bottom = padding.calculateBottomPadding() + 96.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(state.unreadable, key = { "unreadable:$it" }) { id ->
            Notice(
                icon = R.drawable.ic_error,
                title = stringResource(R.string.machines_unreadable_title),
                body = stringResource(R.string.machines_unreadable_body),
                action = { QuietButton(stringResource(R.string.machines_forget), { onForget(id) }) },
            )
        }
        items(state.machines, key = { it.id }) { machine ->
            MachineCard(
                machine = machine,
                onRestartBridge = { onRestartBridge(machine.id) },
                onForget = { onForget(machine.id) },
            )
        }
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
