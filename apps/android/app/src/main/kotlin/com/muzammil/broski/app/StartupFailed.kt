package com.muzammil.broski.app

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import com.muzammil.broski.R
import com.muzammil.broski.core.StartupFailure
import com.muzammil.broski.design.MessageScreen
import com.muzammil.broski.design.SecondaryButton

/**
 * Why the phone could not open. Where the identity itself is lost or damaged, starting over is
 * offered, and only after a confirmation: it orphans every pairing, so it is never done unasked.
 */
@Composable
fun StartupFailed(failure: StartupFailure, onStartOver: () -> Unit) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    val (title, body) = when (failure) {
        StartupFailure.IdentityMissing -> R.string.startup_missing_title to R.string.startup_missing_body
        StartupFailure.IdentityUnreadable -> R.string.startup_identity_title to R.string.startup_identity_body
        StartupFailure.IdentityRefused -> R.string.startup_refused_title to R.string.startup_refused_body
        StartupFailure.StorageUnreadable -> R.string.startup_storage_title to R.string.startup_storage_body
    }
    MessageScreen(R.drawable.ic_error, stringResource(title), stringResource(body)) {
        if (failure.canStartOver) {
            SecondaryButton(stringResource(R.string.startup_start_over), onClick = { confirming = true })
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.startup_start_over_title)) },
            text = { Text(stringResource(R.string.startup_start_over_body)) },
            confirmButton = {
                TextButton(
                    onClick = onStartOver,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.startup_start_over_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.action_cancel)) }
            },
        )
    }
}
