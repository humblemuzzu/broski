package com.muzammil.broski.feature.chat.header

import androidx.annotation.StringRes
import androidx.compose.runtime.Immutable
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.feature.chat.ChatHeader
import com.muzammil.broski.feature.chat.compactTokens
import com.muzammil.broski.feature.chat.composer.Catalog
import java.util.Locale
import kotlin.math.roundToInt
import uniffi.broski_contract.SessionRef
import uniffi.broski_contract.SessionSnapshot
import uniffi.broski_contract.Usage

/** What Session info shows of a session: who and where, the model and its settings, and what it used. */
@Immutable
data class SessionInfo(
    val title: String?,
    val agent: Agent,
    val machineName: String,
    val sessionId: String,
    val cwd: String?,
    val model: String?,
    /** The model's id, when it says more than [model] does. */
    val modelId: String?,
    val thinking: String?,
    /** Each active mode as its axis's name and the chosen option's, in the snapshot's order. */
    val modes: List<Pair<String, String>>,
    val usage: Usage?,
    val contextWindow: Long?,
)

/** A token count or the cost, under its name. */
data class UsageFact(@param:StringRes val label: Int, val value: String)

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
        modelId = snapshot.modelId?.takeIf { model != null && it != model.displayName },
        thinking = thinking,
        modes = modes,
        usage = snapshot.usage,
        contextWindow = snapshot.usage?.contextWindow ?: model?.contextWindow,
    )
}

fun contextFill(used: Long?, window: Long?): ContextFill? {
    used ?: return null
    val size = window?.takeIf { it > 0 } ?: return null
    val fraction = (used.toDouble() / size).coerceIn(0.0, 1.0)
    return ContextFill("${compactTokens(used)} / ${compactTokens(size)}", fraction.toFloat(), (fraction * 100).roundToInt())
}

/** Input, output, cache read and write, reasoning and cost, each only when the backend reported it. */
fun Usage.facts(locale: Locale = Locale.getDefault()): List<UsageFact> = listOfNotNull(
    inputTokens?.let { UsageFact(R.string.info_input, tokens(it, locale)) },
    outputTokens?.let { UsageFact(R.string.info_output, tokens(it, locale)) },
    cacheReadTokens?.let { UsageFact(R.string.info_cache_read, tokens(it, locale)) },
    cacheWriteTokens?.let { UsageFact(R.string.info_cache_write, tokens(it, locale)) },
    reasoningTokens?.let { UsageFact(R.string.info_reasoning, tokens(it, locale)) },
    costUsd?.let { UsageFact(R.string.info_cost, cost(it)) },
)

private fun tokens(count: Long, locale: Locale): String = String.format(locale, "%,d", count)

/** "$0.42", and "<$0.01" for a cost too small to show in cents. */
fun cost(usd: Double): String = if (usd > 0 && usd < 0.005) "<$0.01" else String.format(Locale.ROOT, "$%.2f", usd)
