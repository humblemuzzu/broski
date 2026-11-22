package com.muzammil.broski.feature.settings

import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.design.groupedListItemColors

private data class NotificationRow(val kind: NotificationKind, @param:StringRes val title: Int, @param:StringRes val body: Int)

private val NotificationRows = listOf(
    NotificationRow(NotificationKind.NeedsYou, R.string.settings_notify_needs_you, R.string.settings_notify_needs_you_body),
    NotificationRow(NotificationKind.Done, R.string.settings_notify_done, R.string.settings_notify_done_body),
    NotificationRow(NotificationKind.Failures, R.string.settings_notify_failures, R.string.settings_notify_failures_body),
)

/** Settings › Notifications: which kinds alert, kept on this phone, and on Android 16 whether running agents may show as a Live Update. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NotificationSettingsScreen(core: AppCore, onBack: () -> Unit) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val enabled = state.settings.notifications
    SettingsPage(stringResource(R.string.settings_notifications), onBack) {
        NotificationRows.forEachIndexed { index, row ->
            item(key = "notify:${row.kind}") {
                val checked = row.kind in enabled
                SegmentedListItem(
                    checked = checked,
                    onCheckedChange = { viewModel.setNotification(row.kind, it) },
                    shapes = ListItemDefaults.segmentedShapes(index, NotificationRows.size),
                    modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                    supportingContent = { Text(stringResource(row.body)) },
                    trailingContent = { Switch(checked = checked, onCheckedChange = null) },
                    colors = groupedListItemColors(),
                ) { Text(stringResource(row.title)) }
            }
        }
        item(key = "muted") { SettingsFooter(stringResource(R.string.settings_notify_footer)) }
        if (Build.VERSION.SDK_INT >= 36) {
            item(key = "live-promotion") { LiveUpdatePromotionRow() }
        }
    }
}

/** On Android 16, while the system would not promote the Live Update: a way to the switch that lets it. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun LiveUpdatePromotionRow() {
    if (Build.VERSION.SDK_INT < 36) return
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(NotificationManager::class.java) }
    if (manager?.canPostPromotedNotifications() == true) return
    Spacer(Modifier.height(16.dp))
    SegmentedListItem(
        onClick = {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            context.startActivity(intent)
        },
        shapes = ListItemDefaults.segmentedShapes(0, 1),
        modifier = Modifier.padding(horizontal = 16.dp),
        supportingContent = { Text(stringResource(R.string.settings_live_promotion_body)) },
        trailingContent = { Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.settings_live_promotion)) }
}
