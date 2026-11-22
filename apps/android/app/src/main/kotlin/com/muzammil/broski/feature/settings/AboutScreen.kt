package com.muzammil.broski.feature.settings

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.BuildConfig
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.groupedListItemColors
import uniffi.broski_core.coreVersion

private const val SOURCE_URL = "https://github.com/humblemuzzu/broski"

/** Settings › About: the app and its version, where its source lives, its licence, and how the link is kept private. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AboutScreen(onBack: () -> Unit) {
    val uri = LocalUriHandler.current
    SettingsPage(stringResource(R.string.settings_about), onBack) {
        item(key = "app") {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Image(
                    painterResource(R.drawable.ic_launcher_foreground),
                    contentDescription = null,
                    modifier = Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(colorResource(R.color.launcher_background)),
                )
                Text(stringResource(R.string.settings_version_app), style = MaterialTheme.typography.titleLarge)
                Text(
                    stringResource(R.string.settings_version_label, BuildConfig.VERSION_NAME),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item(key = "source") {
            SegmentedListItem(
                onClick = { uri.openUri(SOURCE_URL) },
                shapes = ListItemDefaults.segmentedShapes(0, 2),
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                trailingContent = { Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                colors = groupedListItemColors(),
            ) { Text(stringResource(R.string.settings_source)) }
            SegmentedListItem(
                shapes = ListItemDefaults.segmentedShapes(1, 2),
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                trailingContent = { Text(stringResource(R.string.settings_license_mit), color = MaterialTheme.colorScheme.onSurfaceVariant) },
                colors = groupedListItemColors(),
            ) { Text(stringResource(R.string.settings_license)) }
        }
        item(key = "privacy") {
            Row(
                Modifier.padding(horizontal = 32.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(painterResource(R.drawable.ic_lock), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.settings_privacy), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Settings › Developer: every kind of text an agent writes as the chat draws it, and the versions the phone and each Mac speak. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun DeveloperScreen(phone: PhoneSession, onBack: () -> Unit) {
    val machines by phone.machines.collectAsStateWithLifecycle()
    var gallery by rememberSaveable { mutableStateOf(false) }
    if (gallery) FormattingGallery(onDismiss = { gallery = false })
    val core = remember { coreVersion() }
    val coreDescription = stringResource(R.string.settings_core_version, core.library, core.protocol.major, core.protocol.minor)
    SettingsPage(stringResource(R.string.settings_developer), onBack) {
        item(key = "gallery") {
            SettingsLink(0, 1, stringResource(R.string.format_gallery), R.drawable.ic_wrap_text, TileTint.Neutral, onClick = { gallery = true })
            SettingsFooter(stringResource(R.string.format_gallery_body))
        }
        item(key = "versions") {
            val count = 1 + machines.size
            Spacer(Modifier.height(12.dp))
            VersionRow(stringResource(R.string.settings_version_core), coreDescription, 0, count)
            machines.forEachIndexed { index, machine ->
                VersionRow(
                    machine.name,
                    machine.bridgeVersion?.let { stringResource(R.string.machines_bridge_version, it) } ?: stringResource(R.string.settings_bridge_unknown),
                    index + 1,
                    count,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun VersionRow(title: String, value: String, index: Int, count: Int) {
    SegmentedListItem(
        shapes = ListItemDefaults.segmentedShapes(index, count),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        supportingContent = { Text(value) },
        colors = groupedListItemColors(),
    ) { Text(title) }
}
