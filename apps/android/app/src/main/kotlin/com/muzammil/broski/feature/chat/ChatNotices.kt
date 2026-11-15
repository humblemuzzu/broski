package com.muzammil.broski.feature.chat

import uniffi.broski_contract.BackendExtension
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.RateLimitStatus
import uniffi.broski_contract.RateLimitUpdate
import uniffi.broski_core.SessionChange
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToInt

/** What a change of the session says to the person as a notice card. */
data class NoticeText(val level: NoticeLevel, val text: String)

/** The notice a change raises, or `null`: the backend's notices and errors, and Claude Code's rate limit. */
fun noticeOf(change: SessionChange, clock: (Long) -> String = ::shortTime): NoticeText? = when (change) {
    is SessionChange.NoticeShown -> NoticeText(change.notice.level, change.notice.text)
    is SessionChange.ErrorShown -> NoticeText(NoticeLevel.ERROR, change.error.error.message)
    is SessionChange.ExtensionReceived -> (change.extension as? BackendExtension.RateLimit)?.let { rateLimitNotice(it.v1, clock) }
    else -> null
}

/** A rate limit worth saying, in the words the iOS chat uses: a warning, or a refusal with when it lifts. */
private fun rateLimitNotice(update: RateLimitUpdate, clock: (Long) -> String): NoticeText? = when (update.status) {
    RateLimitStatus.REJECTED -> {
        val resets = update.resetsAt?.let(clock)
        NoticeText(NoticeLevel.WARNING, if (resets != null) "Usage limit reached. It resets at $resets." else "Usage limit reached.")
    }
    RateLimitStatus.ALLOWED_WARNING -> {
        val used = update.usedPercent?.let { "${it.roundToInt()}% of" } ?: "Most of"
        NoticeText(NoticeLevel.INFO, "$used the usage limit is used.")
    }
    RateLimitStatus.ALLOWED, null -> null
}

private fun shortTime(millis: Long): String =
    DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).format(Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()))
