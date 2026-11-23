package com.muzammil.broski.feature.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.muzammil.broski.R

/** Whether Broski may notify: on, off with the system's question still to ask, or off until the person changes it in Settings. */
enum class NotificationStatus { On, CanAsk, Denied }

/**
 * The notification status, read again each time the app comes back to the front, and a way to ask
 * the system's question. A question answered no is Denied from then on; Android asks at most twice.
 */
@Composable
fun rememberNotificationStatus(): Pair<NotificationStatus, () -> Unit> {
    val context = LocalContext.current
    var asked by rememberSaveable { mutableStateOf(false) }
    var status by remember { mutableStateOf(notificationStatus(context, asked)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        asked = true
        status = notificationStatus(context, asked = true)
    }
    LifecycleResumeEffect(asked) {
        status = notificationStatus(context, asked)
        onPauseOrDispose {}
    }
    return status to {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

private fun notificationStatus(context: Context, asked: Boolean): NotificationStatus = when {
    NotificationManagerCompat.from(context).areNotificationsEnabled() -> NotificationStatus.On
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !asked &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED -> NotificationStatus.CanAsk
    else -> NotificationStatus.Denied
}

/** Asks for the notification permission with its one-line why, once a pairing has made it useful. */
@Stable
class NotificationAsk internal constructor(private val askNow: () -> Unit) {
    fun ask() = askNow()
}

val LocalNotificationAsk = staticCompositionLocalOf { NotificationAsk {} }

/**
 * Android 13+ only, and only while the permission is not granted: a short dialog says why ("so you
 * can approve from the lock screen"), and Allow brings up the system's own question.
 */
@Composable
fun rememberNotificationAsk(): NotificationAsk {
    val context = LocalContext.current
    var showing by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    if (showing) {
        AlertDialog(
            onDismissRequest = { showing = false },
            icon = { Icon(painterResource(R.drawable.ic_notification), contentDescription = null) },
            title = { Text(stringResource(R.string.notify_ask_title)) },
            text = { Text(stringResource(R.string.notify_ask_body)) },
            confirmButton = {
                TextButton(onClick = {
                    showing = false
                    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }) { Text(stringResource(R.string.notify_ask_allow)) }
            },
            dismissButton = { TextButton(onClick = { showing = false }) { Text(stringResource(R.string.notify_ask_later)) } },
        )
    }
    return remember(context) {
        NotificationAsk {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                showing = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            }
        }
    }
}
