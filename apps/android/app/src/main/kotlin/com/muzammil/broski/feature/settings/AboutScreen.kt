package com.muzammil.broski.feature.settings

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.BuildConfig
import com.muzammil.broski.R
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.IosText
import uniffi.broski_core.coreVersion

private const val SOURCE_URL = "https://github.com/humblemuzzu/broski"

/** Settings › About: the version, where the source lives, its licence, protocol versions, and how the link is kept private. */
@Composable
fun AboutScreen(phone: PhoneSession, onBack: () -> Unit) {
    val uri = LocalUriHandler.current
    val machines by phone.machines.collectAsStateWithLifecycle()
    val core = remember { coreVersion() }
    val coreDescription = stringResource(R.string.settings_core_version, core.library, core.protocol.major, core.protocol.minor)
    SettingsPage(stringResource(R.string.settings_about), onBack) {
        item(key = "app") { AppMark() }
        item(key = "source") {
            FormValueRow(0, 2, stringResource(R.string.settings_source), "", onClick = { uri.openUri(SOURCE_URL) }) {
                Icon(painterResource(R.drawable.ic_arrow_outward), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            }
            FormValueRow(1, 2, stringResource(R.string.settings_license), stringResource(R.string.settings_license_mit))
        }
        item(key = "privacy") {
            Row(
                Modifier.padding(start = 36.dp, end = 36.dp, top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    painterResource(R.drawable.ic_lock),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp).size(14.dp),
                )
                Text(stringResource(R.string.settings_privacy), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item(key = "versions") {
            val count = 1 + machines.size
            FormHeader(stringResource(R.string.settings_versions))
            FormValueRow(0, count, stringResource(R.string.settings_version_core), coreDescription)
            machines.forEachIndexed { index, machine ->
                FormValueRow(
                    index + 1,
                    count,
                    machine.name,
                    machine.bridgeVersion?.let { stringResource(R.string.machines_bridge_version, it) } ?: stringResource(R.string.settings_bridge_unknown),
                )
            }
        }
    }
}

@Composable
private fun AppMark() {
    Column(
        Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painterResource(R.drawable.broski_icon),
            contentDescription = null,
            modifier = Modifier.size(72.dp).clip(RoundedCornerShape(16.2.dp)),
        )
        Text(
            stringResource(R.string.settings_version_app),
            fontSize = 22.sp,
            lineHeight = 28.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 12.dp),
        )
        Text(
            stringResource(R.string.settings_version_label, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
            style = IosText.subheadline,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}
