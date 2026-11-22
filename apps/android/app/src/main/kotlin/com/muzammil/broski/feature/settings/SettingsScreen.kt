package com.muzammil.broski.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.BuildConfig
import com.muzammil.broski.R
import com.muzammil.broski.app.AboutRoute
import com.muzammil.broski.app.AppearanceRoute
import com.muzammil.broski.app.DeveloperRoute
import com.muzammil.broski.app.MachinesRoute
import com.muzammil.broski.app.NotificationSettingsRoute
import com.muzammil.broski.app.PairRoute
import com.muzammil.broski.app.Route
import com.muzammil.broski.app.VoiceRoute
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.label
import com.muzammil.broski.design.settling

/** Settings: the paired Macs on top, then what the phone does, then about and the developer's tools, the version under all. */
@Composable
fun SettingsScreen(core: AppCore, phone: PhoneSession, open: (Route) -> Unit) {
    val machines by phone.machines.collectAsStateWithLifecycle()
    val settings by core.settings.collectAsStateWithLifecycle()
    val voiceKey by core.dictation.key.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val notificationsOn = remember(context) { NotificationManagerCompat.from(context).areNotificationsEnabled() }
    val appearance = settings?.appearance ?: Appearance.System

    SettingsPage(stringResource(R.string.settings_title), onBack = null) {
        val macRows = machines.size + 1
        itemsIndexed(machines, key = { _, machine -> "mac:${machine.id}" }) { index, machine ->
            MacRow(machine, index, macRows) { open(MachinesRoute) }
        }
        item(key = "pair") {
            SettingsLink(
                index = machines.size,
                count = macRows,
                title = stringResource(if (machines.isEmpty()) R.string.settings_pair else R.string.settings_pair_another),
                icon = R.drawable.ic_add,
                tint = TileTint.Neutral,
                onClick = { open(PairRoute) },
            )
        }
        item(key = "phone") {
            Spacer(Modifier.height(20.dp))
            SettingsLink(
                0, 3, stringResource(R.string.settings_notifications), R.drawable.ic_notifications, TileTint.Notifications,
                onClick = { open(NotificationSettingsRoute) },
                value = stringResource(if (notificationsOn) R.string.settings_on else R.string.settings_off),
            )
            SettingsLink(
                1, 3, stringResource(R.string.settings_appearance), R.drawable.ic_palette, TileTint.Appearance,
                onClick = { open(AppearanceRoute) },
                value = stringResource(appearance.label),
            )
            SettingsLink(
                2, 3, stringResource(R.string.voice_title), R.drawable.ic_graphic_eq, TileTint.Voice,
                onClick = { open(VoiceRoute) },
                value = stringResource(if (voiceKey != null) R.string.settings_voice_grok else R.string.settings_voice_device),
            )
        }
        item(key = "about") {
            Spacer(Modifier.height(20.dp))
            SettingsLink(0, 2, stringResource(R.string.settings_about), R.drawable.ic_info, TileTint.Neutral, onClick = { open(AboutRoute) })
            SettingsLink(1, 2, stringResource(R.string.settings_developer), R.drawable.ic_code, TileTint.Neutral, onClick = { open(DeveloperRoute) })
        }
        item(key = "version") {
            Text(
                stringResource(R.string.settings_version_footer, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
            )
        }
    }
}

/** A paired Mac: its name, and how it is connected beside a dot of its health; opens Machines. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun MacRow(machine: MachineState, index: Int, count: Int, onClick: () -> Unit) {
    SegmentedListItem(
        onClick = onClick,
        shapes = ListItemDefaults.segmentedShapes(index, count),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        leadingContent = {
            Box(
                Modifier.size(48.dp).background(MaterialTheme.colorScheme.surfaceContainerHighest, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(R.drawable.ic_laptop_mac), contentDescription = null, modifier = Modifier.size(26.dp))
            }
        },
        supportingContent = {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).background(machine.health.dot(), CircleShape))
                Text(machine.health.label(machine.name), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        trailingContent = {
            Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        },
        colors = groupedListItemColors(),
    ) { Text(machine.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}

@Composable
private fun MachineHealth.dot(): Color = when {
    isOnline -> BroskiTheme.semantic.done
    settling -> MaterialTheme.colorScheme.onSurfaceVariant
    this is MachineHealth.Revoked || this is MachineHealth.Refused -> MaterialTheme.colorScheme.error
    else -> BroskiTheme.semantic.caution
}

private val Appearance.label: Int
    get() = when (this) {
        Appearance.System -> R.string.settings_appearance_system
        Appearance.Light -> R.string.settings_appearance_light
        Appearance.Dark -> R.string.settings_appearance_dark
    }
