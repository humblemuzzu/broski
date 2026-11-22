package com.muzammil.broski.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import uniffi.broski_contract.CacheConfidence
import uniffi.broski_contract.CacheWindow

/**
 * The wall clock for [cache]'s countdown: moved each time its shown time changes, and left alone
 * once the window expires or when it has no lifetime, so an idle chat runs no loop.
 */
@Composable
fun cacheNow(cache: CacheWindow?): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(cache?.lastTouchAt, cache?.ttlMs, cache?.confidence) {
        tickCacheClock(cache?.expiresAtMs, cache?.confidence == CacheConfidence.ESTIMATED, System::currentTimeMillis) { now = it }
    }
    return now
}

@Composable
fun CacheTone.color(): Color = when (this) {
    CacheTone.CALM -> BroskiTheme.semantic.done
    CacheTone.EXPIRING -> BroskiTheme.semantic.caution
    CacheTone.QUIET -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** Above the model choices while switching would throw a warm prefix away. */
@Composable
fun CacheSwitchNotice(cache: CacheWindow?, modifier: Modifier = Modifier) {
    val now = cacheNow(cache?.takeIf { it.warnsOnModelSwitch })
    val warning = cache?.switchWarning(now) ?: return
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painterResource(R.drawable.ic_schedule),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp).padding(top = 1.dp),
        )
        Text(
            warning,
            style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
