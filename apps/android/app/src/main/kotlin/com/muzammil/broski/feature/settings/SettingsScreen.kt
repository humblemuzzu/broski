package com.muzammil.broski.feature.settings

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
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
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.feature.notifications.NotificationStatus
import com.muzammil.broski.feature.notifications.rememberNotificationStatus
import com.muzammil.broski.design.IosText

/** Settings: the paired Macs on top, then what the phone does, then about and the developer's tools, the version under all. */
@Composable
fun SettingsScreen(core: AppCore, phone: PhoneSession, open: (Route) -> Unit) {
    val machines by phone.machines.collectAsStateWithLifecycle()
    val settings by core.settings.collectAsStateWithLifecycle()
    val voiceKey by core.dictation.key.collectAsStateWithLifecycle()
    val notificationsOn = rememberNotificationStatus().first == NotificationStatus.On
    val appearance = settings?.appearance ?: Appearance.System

    SettingsPage(stringResource(R.string.settings_title), onBack = null) {
        val macRows = machines.size + 1
        itemsIndexed(machines, key = { _, machine -> "mac:${machine.id}" }) { index, machine ->
            LinkCard(machine, phone, index, macRows) { open(MachinesRoute) }
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
                style = IosText.footnote,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
            )
        }
    }
}

private val Appearance.label: Int
    get() = when (this) {
        Appearance.System -> R.string.settings_appearance_system
        Appearance.Light -> R.string.settings_appearance_light
        Appearance.Dark -> R.string.settings_appearance_dark
    }
