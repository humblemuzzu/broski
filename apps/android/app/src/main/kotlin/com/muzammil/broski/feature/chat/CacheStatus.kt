package com.muzammil.broski.feature.chat

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import uniffi.broski_contract.CacheConfidence
import uniffi.broski_contract.CacheWindow

/**
 * What the prompt cache says at a moment, in the words the iOS chat uses. The bridge sends the
 * window once per request, never a countdown, so the phone counts: warm while the lifetime the
 * backend published lasts, then only how much of the last prompt the cache served
 * (open-source-blueprint.md §3.4). No lifetime, no timer.
 */
sealed interface CacheStatus {
    data class Warm(val remainingMs: Long, val estimated: Boolean, val hitPercent: Int?) : CacheStatus

    data class HitOnly(val hitPercent: Int) : CacheStatus
}

enum class CacheTone { CALM, EXPIRING, QUIET }

const val CACHE_SWITCH_WARNING_TOKENS = 20_000L
private const val EXPIRING_MS = 60_000L

fun cacheStatus(cache: CacheWindow?, nowMs: Long): CacheStatus? {
    cache ?: return null
    val remaining = cache.remainingMs(nowMs)
    val hit = cache.hitPercent
    return when {
        remaining != null && remaining > 0 -> CacheStatus.Warm(remaining, cache.confidence == CacheConfidence.ESTIMATED, hit)
        hit != null && (cache.cachedTokens ?: 0) > 0 -> CacheStatus.HitOnly(hit)
        else -> null
    }
}

val CacheStatus.tone: CacheTone
    get() = when (this) {
        is CacheStatus.Warm -> if (remainingMs > EXPIRING_MS) CacheTone.CALM else CacheTone.EXPIRING
        is CacheStatus.HitOnly -> CacheTone.QUIET
    }

/** "Cache 3m 42s · 94%", "Cache ~3m", "91% cached". */
val CacheStatus.compact: String
    get() = when (this) {
        is CacheStatus.Warm -> "Cache " + cacheDuration(remainingMs, estimated) + (hitPercent?.let { " · $it%" } ?: "")
        is CacheStatus.HitOnly -> "$hitPercent% cached"
    }

val CacheWindow.expiresAtMs: Long? get() = ttlMs?.let { lastTouchAt + it }

/** Never more than the lifetime, so a phone clock behind the Mac's does not stretch it. */
fun CacheWindow.remainingMs(nowMs: Long): Long? {
    val ttl = ttlMs ?: return null
    return (lastTouchAt + ttl - nowMs).coerceIn(0, ttl.coerceAtLeast(0))
}

val CacheWindow.hitPercent: Int?
    get() {
        val cached = cachedTokens ?: return null
        val prompt = promptTokens?.takeIf { it > 0 } ?: return null
        return (cached.toDouble() / prompt * 100).roundToInt().coerceIn(0, 100)
    }

/** Enough is cached, under a lifetime, that a model switch would start a costly prefix over. */
val CacheWindow.warnsOnModelSwitch: Boolean get() = ttlMs != null && (cachedTokens ?: 0) >= CACHE_SWITCH_WARNING_TOKENS

fun CacheWindow.shouldWarnOnModelSwitch(nowMs: Long): Boolean = warnsOnModelSwitch && (remainingMs(nowMs) ?: 0) > 0

/** "Cache warm (142k tokens, 3m 42s left) — switching models will re-cache". */
fun CacheWindow.switchWarning(nowMs: Long): String? {
    if (!shouldWarnOnModelSwitch(nowMs)) return null
    val left = cacheDuration(remainingMs(nowMs) ?: 0, confidence == CacheConfidence.ESTIMATED)
    return "Cache warm (${compactTokens(cachedTokens ?: 0)} tokens, $left left) — switching models will re-cache"
}

/** The overflow's lines: how much of the last prompt was cached, and when the window closes, as a time of day. */
fun CacheWindow.breakdown(clock: (Long) -> String = ::cacheTimeOfDay): List<String> {
    if ((cachedTokens ?: 0) <= 0 && ttlMs == null) return emptyList()
    val cached = cachedTokens
    val prompt = promptTokens
    val hit = hitPercent
    return listOfNotNull(
        if (cached != null && prompt != null && hit != null) "${compactTokens(cached)} of ${compactTokens(prompt)} prompt tokens cached ($hit%)" else null,
        expiresAtMs?.let { (if (confidence == CacheConfidence.ESTIMATED) "Expires about " else "Expires ") + clock(it) },
    )
}

/** "1h 02m", "3m 42s", "42s", whole seconds counted up; an estimate drops the seconds behind a "~": "~3m". */
fun cacheDuration(ms: Long, estimated: Boolean): String {
    val seconds = (ms.coerceAtLeast(0) + 999) / 1_000
    val hours = seconds / 3_600
    val minutes = seconds % 3_600 / 60
    val secs = seconds % 60
    val span = when {
        hours > 0 -> String.format(Locale.ROOT, "%dh %02dm", hours, minutes)
        minutes > 0 && estimated -> "${minutes}m"
        minutes > 0 -> String.format(Locale.ROOT, "%dm %02ds", minutes, secs)
        else -> "${secs}s"
    }
    return if (estimated) "~$span" else span
}

/** "842", "142k", "1.2M". */
fun compactTokens(count: Long): String = when {
    count < 1_000 -> "$count"
    count < 1_000_000 -> "${count / 1_000}k"
    else -> String.format(Locale.ROOT, "%.1fM", count / 1_000_000.0)
}

/** How long until the shown second changes: the moment the next whole second falls past. */
fun nextCacheTickMs(remainingMs: Long): Long = (remainingMs.coerceAtLeast(1) - 1) % 1_000 + 1

/** Reads [clock] into [onTick] now and each time the shown second changes, returning at [expiresAtMs], or at once without one. */
suspend fun tickCacheClock(expiresAtMs: Long?, clock: () -> Long, onTick: (Long) -> Unit) {
    var now = clock()
    onTick(now)
    while (expiresAtMs != null && now < expiresAtMs) {
        delay(nextCacheTickMs(expiresAtMs - now))
        now = clock()
        onTick(now)
    }
}

private fun cacheTimeOfDay(millis: Long): String =
    DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).format(Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()))
