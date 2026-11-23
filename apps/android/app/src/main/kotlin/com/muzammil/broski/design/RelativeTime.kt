package com.muzammil.broski.design

import android.text.format.DateFormat
import android.text.format.DateUtils
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
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

/** A row's age in as few characters as read: "now", "5m", "2h", "3d", then the day itself. */
@Composable
fun shortAge(epochMs: Long): String {
    val now = LocalNow.current
    val locale = LocalConfiguration.current.locales[0]
    val seconds = maxOf(0L, now - epochMs) / 1000
    return when {
        seconds < 60 -> stringResource(R.string.inbox_age_now)
        seconds < 3_600 -> "${seconds / 60}m"
        seconds < 86_400 -> "${seconds / 3_600}h"
        seconds < 30 * 86_400 -> "${seconds / 86_400}d"
        else -> {
            val sameYear = Calendar.getInstance().apply { timeInMillis = epochMs }.get(Calendar.YEAR) ==
                Calendar.getInstance().apply { timeInMillis = now }.get(Calendar.YEAR)
            val pattern = DateFormat.getBestDateTimePattern(locale, if (sameYear) "MMMd" else "MMMyyyy")
            SimpleDateFormat(pattern, locale).format(Date(epochMs))
        }
    }
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
