package com.muzammil.broski.feature.chat.header

import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.feature.chat.ChatHeader
import com.muzammil.broski.feature.chat.cacheTimeOfDay
import com.muzammil.broski.feature.chat.compactTokens
import com.muzammil.broski.feature.chat.expiresAtMs
import com.muzammil.broski.feature.chat.hitPercent
import com.muzammil.broski.feature.chat.composer.Catalog
import com.muzammil.broski.feature.chat.composer.provider
import java.util.Locale
import kotlin.math.roundToInt
import uniffi.broski_contract.CacheConfidence
import uniffi.broski_contract.CacheWindow
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.Usage

/** What Session Info shows of a session: who and where, the model and its settings, and what it used. */
@Immutable
data class SessionInfo(
    val title: String?,
    val agent: Agent,
    val machineName: String,
    val sessionId: String,
    val cwd: String?,
    val model: String?,
    /** Who serves the model, as the agent names them. */
    val provider: String?,
    val thinking: String?,
    /** Each active mode as its axis's name and the chosen option's, in the snapshot's order. */
    val modes: List<Pair<String, String>>,
    val usage: Usage?,
    /** Only the window the Mac reported, as iOS reads it. */
    val contextWindow: Long?,
)

/** A row's name and its value. */
data class InfoLine(@param:StringRes val label: Int, val value: String)

/** How full the context window is: "64k / 200k", and the share as a fraction and a whole percent. */
data class ContextFill(val label: String, val fraction: Float, val percent: Int)

/** Names come from the agent's catalog where it has them, else the snapshot's own ids stand. */
fun sessionInfo(header: ChatHeader, session: SessionRef, snapshot: SessionSnapshot, catalog: Catalog): SessionInfo {
    val model = catalog.models.firstOrNull { it.id == snapshot.modelId }
    val thinking = snapshot.thinking?.let { value -> model?.thinking?.options?.firstOrNull { it.value == value }?.label ?: value }
    val modes = snapshot.modes.map { setting ->
        val axis = catalog.modes.firstOrNull { it.id == setting.axis }
        (axis?.label ?: setting.axis) to (axis?.options?.firstOrNull { it.value == setting.value }?.label ?: setting.value)
    }
    return SessionInfo(
        title = header.title,
        agent = header.agent,
        machineName = header.machineName,
        sessionId = session.sessionId,
        cwd = header.cwd,
        model = model?.displayName ?: snapshot.modelId,
        provider = model?.provider,
        thinking = thinking,
        modes = modes,
        usage = snapshot.usage,
        contextWindow = snapshot.usage?.contextWindow,
    )
}

fun contextFill(used: Long?, window: Long?): ContextFill? {
    used ?: return null
    val size = window?.takeIf { it > 0 } ?: return null
    val fraction = (used.toDouble() / size).coerceIn(0.0, 1.0)
    return ContextFill("${compactTokens(used)} / ${compactTokens(size)}", fraction.toFloat(), (fraction * 100).roundToInt())
}

/** "64k" when the window is not reported. */
fun contextOnly(used: Long?): String? = used?.let(::compactTokens)

/** Input, output, cache read and write, reasoning and cost, each only when the backend reported it. */
fun Usage.facts(locale: Locale = Locale.getDefault()): List<InfoLine> = listOfNotNull(
    inputTokens?.let { InfoLine(R.string.info_input, tokens(it, locale)) },
    outputTokens?.let { InfoLine(R.string.info_output, tokens(it, locale)) },
    cacheReadTokens?.let { InfoLine(R.string.info_cache_read, tokens(it, locale)) },
    cacheWriteTokens?.let { InfoLine(R.string.info_cache_write, tokens(it, locale)) },
    reasoningTokens?.let { InfoLine(R.string.info_reasoning, tokens(it, locale)) },
    costUsd?.let { InfoLine(R.string.info_cost, cost(it)) },
)

/**
 * The cache's hit ratio, the cached share of the prompt, and when the window closes or closed as a
 * time of day: "Hit ratio 94%", "Cached 142k of 150k prompt tokens", "Expires about 14:32".
 */
fun CacheWindow.infoLines(nowMs: Long, words: CacheWords, clock: (Long) -> String = ::cacheTimeOfDay): List<InfoLine> = listOfNotNull(
    hitPercent?.let { InfoLine(R.string.info_hit_ratio, "$it%") },
    cachedTokens?.let { cached ->
        val shown = compactTokens(cached)
        InfoLine(R.string.info_cached, promptTokens?.let { words.ofPrompt(shown, compactTokens(it)) } ?: words.tokens(shown))
    },
    expiresAtMs?.let { at ->
        val closed = at <= nowMs
        val about = !closed && confidence == CacheConfidence.ESTIMATED
        InfoLine(if (closed) R.string.info_expired else R.string.info_expires, (if (about) words.about else "") + clock(at))
    },
)

/** The words the cache rows are spelled with, read from the app's strings by the sheet. */
class CacheWords(val ofPrompt: (String, String) -> String, val tokens: (String) -> String, val about: String)

private fun tokens(count: Long, locale: Locale): String = String.format(locale, "%,d", count)

/** "$0.42"; a cost under a cent keeps up to four decimals rather than reading "$0.00", as iOS shows it. */
fun cost(usd: Double): String = when {
    usd > 0 && usd < 0.01 -> String.format(Locale.ROOT, "$%.4f", usd).trimEnd('0').let { if (it.endsWith('.')) it + "00" else it }
    else -> String.format(Locale.ROOT, "$%.2f", usd)
}
