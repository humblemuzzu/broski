package com.muzammil.broski.feature.screen

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.PrimaryButton
import uniffi.broski_core.AuthScheme

@Composable
fun ScreenScreen(
    phone: PhoneSession,
    machineId: String,
    onBack: () -> Unit,
) {
    val viewModel = viewModel(key = "screen:$machineId") { ScreenViewModel(phone, machineId) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val machines by phone.machines.collectAsStateWithLifecycle()
    val machineName = machines.firstOrNull { it.id == machineId }?.name
        ?: stringResource(R.string.screen_default_title)
    val context = LocalContext.current

    var showToolbar by remember { mutableStateOf(true) }
    var textDialogMode by remember { mutableStateOf<Boolean?>(null) }

    SyncMacClipboard(context, state.clipboardFromMac)

    Scaffold(
        topBar = {
            ScreenTopBar(
                title = state.desktopName.ifBlank { machineName },
                isLive = state.phase == ScreenPhase.Live,
                hasSavedCredentials = state.hasSavedCredentials,
                onBack = onBack,
                onToggleToolbar = { showToolbar = !showToolbar },
                onRefresh = viewModel::refresh,
                onForgetLogin = viewModel::forgetSavedCredentials,
            )
        },
    ) { padding ->
        ScreenBody(
            state = state,
            machineName = machineName,
            showToolbar = showToolbar,
            padding = padding,
            viewModel = viewModel,
            onPaste = { readPhoneClipboard(context)?.let(viewModel::pasteClipboard) },
            onOpenTextDialog = { textDialogMode = it },
        )
    }

    ScreenDialogs(
        phase = state.phase,
        machineName = machineName,
        initialUsername = state.savedUsername,
        textDialogMode = textDialogMode,
        onSubmitAuth = viewModel::submitCredentials,
        onCancelAuth = onBack,
        onSendText = { text, submit ->
            textDialogMode = null
            viewModel.typeText(text, submit)
        },
        onDismissText = { textDialogMode = null },
    )
}

@Composable
private fun SyncMacClipboard(context: Context, text: String?) {
    LaunchedEffect(text) {
        val value = text ?: return@LaunchedEffect
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        manager?.setPrimaryClip(ClipData.newPlainText("Mac clipboard", value))
    }
}

private fun readPhoneClipboard(context: Context): String? {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
    return manager?.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString()?.takeIf { it.isNotEmpty() }
}

@Composable
private fun ScreenTopBar(
    title: String,
    isLive: Boolean,
    hasSavedCredentials: Boolean,
    onBack: () -> Unit,
    onToggleToolbar: () -> Unit,
    onRefresh: () -> Unit,
    onForgetLogin: () -> Unit,
) {
    TopAppBar(
        title = { Text(title) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
            }
        },
        actions = {
            if (isLive) {
                IconButton(onClick = onToggleToolbar) {
                    Icon(painterResource(R.drawable.ic_edit), contentDescription = stringResource(R.string.screen_toggle_controls))
                }
                IconButton(onClick = onRefresh) {
                    Icon(painterResource(R.drawable.ic_restart_alt), contentDescription = stringResource(R.string.screen_refresh))
                }
                if (hasSavedCredentials) {
                    IconButton(onClick = onForgetLogin) {
                        Icon(painterResource(R.drawable.ic_lock), contentDescription = stringResource(R.string.screen_forget_login))
                    }
                }
            }
        },
    )
}

@Composable
private fun ScreenBody(
    state: ScreenUiState,
    machineName: String,
    showToolbar: Boolean,
    padding: PaddingValues,
    viewModel: ScreenViewModel,
    onPaste: () -> Unit,
    onOpenTextDialog: (Boolean) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(padding)) {
        when (val phase = state.phase) {
            is ScreenPhase.Disabled -> EmptyState(
                title = stringResource(R.string.screen_disabled_title),
                body = stringResource(R.string.screen_disabled_body, machineName, phase.detail),
                action = { PrimaryButton(stringResource(R.string.screen_try_again), viewModel::connectSaved) },
            )
            is ScreenPhase.Closed -> EmptyState(
                title = stringResource(R.string.screen_disconnected_title),
                body = phase.detail,
                action = { PrimaryButton(stringResource(R.string.screen_reconnect), viewModel::connectSaved) },
            )
            else -> {
                ScreenCanvas(
                    state = state,
                    onMoveBy = viewModel::moveCursorBy,
                    onClick = viewModel::click,
                    modifier = Modifier.weight(1f),
                )
                if (showToolbar && phase == ScreenPhase.Live) {
                    ScreenToolbar(
                        state = state,
                        onToggleMode = viewModel::togglePointerMode,
                        onPasswordTap = { onOpenTextDialog(true) },
                        onTypeTap = { onOpenTextDialog(false) },
                        onRightClick = { viewModel.click(4U) },
                        onPaste = onPaste,
                        onShortcut = viewModel::sendShortcut,
                        onToggleModifier = viewModel::toggleModifier,
                        onTapKey = viewModel::tapKey,
                        onScroll = viewModel::scroll,
                    )
                }
            }
        }
    }
}

@Composable
private fun ScreenDialogs(
    phase: ScreenPhase,
    machineName: String,
    initialUsername: String,
    textDialogMode: Boolean?,
    onSubmitAuth: (String, String, Boolean) -> Unit,
    onCancelAuth: () -> Unit,
    onSendText: (String, Boolean) -> Unit,
    onDismissText: () -> Unit,
) {
    if (phase is ScreenPhase.AuthRequired) {
        ScreenAuthDialog(
            machineName = machineName,
            initialUsername = initialUsername,
            needsUsername = AuthScheme.APPLE_CREDENTIALS in phase.schemes,
            errorMessage = phase.errorMessage,
            onSubmit = onSubmitAuth,
            onDismiss = onCancelAuth,
        )
    }
    textDialogMode?.let { isPassword ->
        ScreenTextDialog(isPassword = isPassword, onSend = onSendText, onDismiss = onDismissText)
    }
}

@Composable
private fun ScreenAuthDialog(
    machineName: String,
    initialUsername: String,
    needsUsername: Boolean,
    errorMessage: String?,
    onSubmit: (String, String, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var username by remember(initialUsername) { mutableStateOf(initialUsername) }
    var password by remember { mutableStateOf("") }
    var rememberLogin by remember { mutableStateOf(true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.screen_auth_title, machineName)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (errorMessage != null) {
                    Text(
                        errorMessage,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (needsUsername) {
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text(stringResource(R.string.screen_auth_username)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(stringResource(R.string.screen_auth_password)) },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = rememberLogin, onCheckedChange = { rememberLogin = it })
                    Text(stringResource(R.string.screen_auth_remember))
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val u = username.trim()
                    val p = password
                    password = ""
                    onSubmit(u, p, rememberLogin)
                },
                enabled = password.isNotEmpty() && (!needsUsername || username.isNotBlank()),
            ) { Text(stringResource(R.string.screen_auth_connect)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

@Composable
private fun ScreenTextDialog(
    isPassword: Boolean,
    onSend: (String, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    var pressReturn by remember { mutableStateOf(true) }
    val titleRes = if (isPassword) R.string.screen_type_password_title else R.string.screen_type_text_title
    val hintRes = if (isPassword) R.string.screen_auth_password else R.string.screen_type_text_hint
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(titleRes)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text(stringResource(hintRes)) },
                    visualTransformation = if (isPassword) PasswordVisualTransformation() else VisualTransformation.None,
                    singleLine = isPassword,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = pressReturn, onCheckedChange = { pressReturn = it })
                    Text(stringResource(R.string.screen_press_return))
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val value = text
                    text = ""
                    onSend(value, pressReturn)
                },
                enabled = text.isNotEmpty(),
            ) { Text(stringResource(R.string.screen_action_send)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}
