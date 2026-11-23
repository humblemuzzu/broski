package com.muzammil.broski.feature.settings

import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.design.Banner
import com.muzammil.broski.design.BannerStyle
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.feature.notifications.NotificationStatus
import com.muzammil.broski.feature.notifications.rememberNotificationStatus

private data class NotificationRow(val kind: NotificationKind, @param:StringRes val title: Int)

private val NotificationRows = listOf(
    NotificationRow(NotificationKind.NeedsYou, R.string.settings_notify_needs_you),
    NotificationRow(NotificationKind.Done, R.string.settings_notify_done),
    NotificationRow(NotificationKind.Failures, R.string.settings_notify_failures),
)

/**
 * Settings › Notifications: whether Android lets Broski notify, which kinds the person wants, the Live
 * Update, and on Android 16 a way to let the system promote it.
 */
@Composable
fun NotificationSettingsScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val enabled = state.settings.notifications
    val (status, ask) = rememberNotificationStatus()
    val context = LocalContext.current
    SettingsPage(stringResource(R.string.settings_notifications), onBack) {
        when (status) {
            NotificationStatus.Denied -> item(key = "denied") {
                Banner(
                    BannerStyle.Warning,
                    stringResource(R.string.settings_notify_denied),
                    modifier = Modifier.padding(horizontal = Grouped.margin).padding(bottom = 28.dp),
                ) {
                    TextButton(onClick = { context.startActivity(appNotificationSettings(context.packageName)) }) {
                        Text(stringResource(R.string.settings_open_settings), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            NotificationStatus.CanAsk -> {
                item(key = "ask") { FormButtonRow(0, 1, stringResource(R.string.settings_notify_turn_on), ask) }
                formGap("ask-gap")
            }
            NotificationStatus.On -> Unit
        }
        NotificationRows.forEachIndexed { index, row ->
            item(key = "notify:${row.kind}") {
                FormToggle(
                    index, NotificationRows.size, stringResource(row.title),
                    checked = row.kind in enabled,
                    onChange = { viewModel.setNotification(row.kind, it) },
                    enabled = status != NotificationStatus.Denied,
                )
            }
        }
        item(key = "footer") { FormFooter(stringResource(R.string.settings_notify_footer)) }
        item(key = "live-updates") {
            FormToggle(
                0, 1, stringResource(R.string.settings_notify_live_updates),
                checked = state.settings.liveUpdates,
                onChange = viewModel::setLiveUpdates,
                enabled = status != NotificationStatus.Denied,
            )
        }
        item(key = "live-updates-footer") { FormFooter(stringResource(R.string.settings_live_updates_footer)) }
        if (Build.VERSION.SDK_INT >= 36) {
            item(key = "live-promotion") { LiveUpdatePromotion() }
        }
    }
}

private fun appNotificationSettings(packageName: String) =
    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)

/** On Android 16, while the system would not promote the Live Update: a way to the switch that lets it. */
@Composable
private fun LiveUpdatePromotion() {
    if (Build.VERSION.SDK_INT < 36) return
    val context = LocalContext.current
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager?.canPostPromotedNotifications() == true) return
    FormHeader("")
    FormButtonRow(0, 1, stringResource(R.string.settings_live_promotion), onClick = {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        context.startActivity(intent)
    })
    FormFooter(stringResource(R.string.settings_live_promotion_body))
}
