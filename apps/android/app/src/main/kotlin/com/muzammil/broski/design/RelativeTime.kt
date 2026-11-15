package com.muzammil.broski.design

import android.text.format.DateUtils
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import com.muzammil.broski.R
import kotlinx.coroutines.delay

private const val TICK_MS = 30_000L

private val LocalNow = staticCompositionLocalOf { System.currentTimeMillis() }

/** One clock for every relative time under it, ticking while it is composed. */
@Composable
fun ProvideClock(content: @Composable () -> Unit) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    CompositionLocalProvider(LocalNow provides now, content = content)
}

/** "Just now", "2 min. ago", "Yesterday", in the phone's language. */
@Composable
fun relativeTime(epochMs: Long): String {
    val now = maxOf(LocalNow.current, epochMs)
    if (now - epochMs < DateUtils.MINUTE_IN_MILLIS) return stringResource(R.string.time_just_now)
    return DateUtils.getRelativeTimeSpanString(
        epochMs,
        now,
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE,
    ).toString()
}
