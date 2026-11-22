package com.muzammil.broski.feature.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.usage.StatsMetric
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.EmptyState
import kotlinx.coroutines.launch
import uniffi.broski_contract.StatsHarnessEntry
import uniffi.broski_contract.StatsResolution
import uniffi.broski_contract.StatsSummary
import uniffi.broski_contract.StatsTotals

private enum class BreakdownMode(val caption: String) {
    MODELS("Models"),
    TIME("Time"),
    PROJECTS("Projects"),
    AGENTS("Agents"),
}

@Composable
fun StatsTabContent(core: AppCore, phone: PhoneSession) {
    val summary by core.stats.summary.collectAsStateWithLifecycle()
    val range by core.stats.range.collectAsStateWithLifecycle()
    val metric by core.stats.metric.collectAsStateWithLifecycle()
    val selectedHarness by core.stats.selectedHarness.collectAsStateWithLifecycle()
    val machines by phone.machines.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var breakdown by remember { mutableStateOf(BreakdownMode.MODELS) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (option in ORDERED_STATS_RANGES) {
                FilterChip(
                    selected = range == option,
                    onClick = { scope.launch { core.stats.selectRange(option, phone) } },
                    label = { Text(option.shortName()) },
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            if (selectedHarness != null) {
                val active = selectedHarness!!
                InputChip(
                    selected = true,
                    onClick = { scope.launch { core.stats.clearHarness(phone) } },
                    label = { Text("${active.displayName()} ×") },
                )
            } else {
                Spacer(Modifier.width(1.dp))
            }
            SingleChoiceSegmentedButtonRow {
                StatsMetric.entries.forEachIndexed { idx, item ->
                    SegmentedButton(
                        selected = metric == item,
                        onClick = { core.stats.setMetric(item) },
                        shape = SegmentedButtonDefaults.itemShape(index = idx, count = StatsMetric.entries.size),
                    ) {
                        Text(if (item == StatsMetric.COST) "Cost" else "Tokens")
                    }
                }
            }
        }

        val current = summary
        if (current == null) {
            EmptyState(
                title = "No stats yet",
                body = if (machines.any { it.health.isOnline }) {
                    "Pull to refresh to scan local Claude Code, Pi, Codex, OpenCode, Antigravity, Grok, and Gemini logs."
                } else {
                    "Your Mac scans local agent history once connected."
                },
                modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
            )
        } else {
            HeroCard(
                stats = current,
                metric = metric,
                selectedHarness = selectedHarness,
                onToggleHarness = { h -> scope.launch { core.stats.toggleHarness(h, phone) } },
            )
            StatsActivityChartCard(
                series = current.series,
                resolution = current.resolution,
                metric = metric,
            )
            TotalsCard(current.totals)
            ShareBars(current, metric)
            BreakdownCard(
                stats = current,
                metric = metric,
                mode = breakdown,
                onModeChange = { breakdown = it },
            )
        }
    }
}

@Composable
private fun HeroCard(
    stats: StatsSummary,
    metric: StatsMetric,
    selectedHarness: uniffi.broski_contract.StatsHarness?,
    onToggleHarness: (uniffi.broski_contract.StatsHarness) -> Unit,
) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    val primaryText = if (metric == StatsMetric.COST) {
        StatsFormat.usd(stats.totals.cost.total)
    } else {
        StatsFormat.tokens(stats.totals.tokens.totalCount)
    }
    val deltaText = stats.previousTotals?.let { prev ->
        if (metric == StatsMetric.COST) {
            StatsFormat.delta(stats.totals.cost.total, prev.cost.total)
        } else {
            StatsFormat.delta(stats.totals.tokens.totalCount.toDouble(), prev.tokens.totalCount.toDouble())
        }
    }
    val sessionWord = if (stats.totals.sessions == 1L) "session" else "sessions"

    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        primaryText,
                        style = MaterialTheme.typography.displaySmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontFeatureSettings = "tnum",
                        ),
                    )
                    if (deltaText != null) {
                        Text(
                            deltaText,
                            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                            color = secondary,
                            modifier = Modifier.padding(bottom = 6.dp),
                        )
                    }
                }
                val meta = if (metric == StatsMetric.COST) {
                    "${stats.totals.sessions} $sessionWord · ${StatsFormat.costSourceCaption(stats.totals.costSource)}"
                } else {
                    "${stats.totals.sessions} $sessionWord · ${stats.totals.turns} turns"
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(meta, style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = secondary)
                    if (metric == StatsMetric.COST && stats.totals.unpricedTurns > 0L) {
                        Text(
                            "(${stats.totals.unpricedTurns} unpriced)",
                            style = MaterialTheme.typography.bodySmall,
                            color = BroskiTheme.semantic.caution,
                        )
                    }
                }
            }

            if (stats.harnesses.isNotEmpty()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    for (entry in stats.harnesses) {
                        HarnessRow(
                            entry = entry,
                            totals = stats.totals,
                            metric = metric,
                            selected = selectedHarness == entry.harness,
                            onClick = { onToggleHarness(entry.harness) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HarnessRow(
    entry: StatsHarnessEntry,
    totals: StatsTotals,
    metric: StatsMetric,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    val share = if (metric == StatsMetric.COST) {
        if (totals.cost.total > 0.0) entry.costUsd / totals.cost.total else 0.0
    } else {
        if (totals.tokens.totalCount > 0L) entry.tokens.totalCount.toDouble() / totals.tokens.totalCount.toDouble() else 0.0
    }
    val valueText = if (metric == StatsMetric.COST) StatsFormat.usd(entry.costUsd) else StatsFormat.tokens(entry.tokens.totalCount)
    val subLine = if (metric == StatsMetric.COST) {
        "${StatsFormat.percent(share)} of cost · ${StatsFormat.tokens(entry.tokens.totalCount)} tokens"
    } else {
        "${StatsFormat.percent(share)} of tokens · ${StatsFormat.usd(entry.costUsd)}"
    }
    val sessWord = if (entry.sessions == 1L) "session" else "sessions"

    Column(Modifier.fillMaxWidth().clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(harnessTint(entry.harness), CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(
                entry.displayName,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            )
            Spacer(Modifier.width(6.dp))
            Text("${entry.sessions} $sessWord", style = MaterialTheme.typography.labelSmall, color = secondary)
            Spacer(Modifier.weight(1f))
            Text(valueText, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"))
        }
        Text(
            subLine,
            style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
            color = secondary,
            modifier = Modifier.padding(start = 16.dp),
        )
    }
}

@Composable
private fun TotalsCard(totals: StatsTotals) {
    val hit = totals.tokens.cacheHitRate?.let { StatsFormat.percent(it) } ?: "—"
    val cacheValue = if (totals.busts > 0L) "$hit · ${totals.busts} busts" else hit
    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Totals", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricCell("Processed tokens", StatsFormat.tokens(totals.tokens.totalCount), Modifier.weight(1f))
                MetricCell("Cached input", StatsFormat.tokens(totals.tokens.cachedInput), Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricCell("Uncached input", StatsFormat.tokens(totals.tokens.uncachedInput), Modifier.weight(1f))
                MetricCell("Output", StatsFormat.tokens(totals.tokens.output), Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricCell("Cache savings", StatsFormat.usd(totals.cacheSavingsUsd), Modifier.weight(1f))
                MetricCell("Cache hit", cacheValue, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun MetricCell(heading: String, value: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(heading, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"), maxLines = 1)
    }
}

@Composable
private fun ShareBars(stats: StatsSummary, metric: StatsMetric) {
    if (stats.totals.tokens.totalCount <= 0L) return
    if (metric == StatsMetric.TOKENS) {
        val aside = if (stats.totals.tokens.reasoning > 0L) "${StatsFormat.tokens(stats.totals.tokens.reasoning)} reasoning" else null
        StatsShareBarCard(
            heading = "Tokens by type",
            aside = aside,
            segments = listOf(
                ShareSegment("Cache read", stats.totals.tokens.cachedInput.toDouble(), Color(0xFF34D399)),
                ShareSegment("Cache write", stats.totals.tokens.cacheCreation.toDouble(), Color(0xFFF59E0B)),
                ShareSegment("Uncached input", stats.totals.tokens.uncachedInput.toDouble(), Color(0xFF3B82F6)),
                ShareSegment("Output", stats.totals.tokens.output.toDouble(), Color(0xFFA855F7)),
            ),
            formatValue = { StatsFormat.tokens(it.toLong()) },
        )
    } else {
        StatsShareBarCard(
            heading = "Cost by type",
            aside = null,
            segments = listOf(
                ShareSegment("Uncached input", stats.totals.cost.input, Color(0xFF3B82F6)),
                ShareSegment("Output", stats.totals.cost.output, Color(0xFFA855F7)),
                ShareSegment("Cache read", stats.totals.cost.cacheRead, Color(0xFF34D399)),
                ShareSegment("Cache write", stats.totals.cost.cacheWrite, Color(0xFFF59E0B)),
            ),
            formatValue = StatsFormat::usd,
        )
        if (stats.totals.speedCost.fast + stats.totals.speedCost.ultrafast > 0.0) {
            val premiumAside = if (stats.totals.speedCost.premium > 0.0) "+${StatsFormat.usd(stats.totals.speedCost.premium)} premium" else null
            StatsShareBarCard(
                heading = "Cost by speed",
                aside = premiumAside,
                segments = listOf(
                    ShareSegment("Standard", stats.totals.speedCost.standard, Color(0xFF3B82F6)),
                    ShareSegment("Fast", stats.totals.speedCost.fast, Color(0xFFF59E0B)),
                    ShareSegment("Ultrafast", stats.totals.speedCost.ultrafast, Color(0xFFEF4444)),
                ),
                formatValue = StatsFormat::usd,
            )
        }
    }
}

@Composable
private fun BreakdownCard(
    stats: StatsSummary,
    metric: StatsMetric,
    mode: BreakdownMode,
    onModeChange: (BreakdownMode) -> Unit,
) {
    val modes = if (stats.subagents.isEmpty()) {
        listOf(BreakdownMode.MODELS, BreakdownMode.TIME, BreakdownMode.PROJECTS)
    } else {
        BreakdownMode.entries
    }
    val activeMode = if (mode in modes) mode else BreakdownMode.MODELS
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant

    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Breakdown", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                modes.forEachIndexed { idx, m ->
                    val cap = if (m == BreakdownMode.TIME && stats.resolution == StatsResolution.HOUR) "Hours" else m.caption
                    SegmentedButton(
                        selected = activeMode == m,
                        onClick = { onModeChange(m) },
                        shape = SegmentedButtonDefaults.itemShape(index = idx, count = modes.size),
                    ) {
                        Text(cap, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }

            when (activeMode) {
                BreakdownMode.MODELS -> {
                    val list = if (metric == StatsMetric.TOKENS) stats.models.sortedByDescending { it.tokens.totalCount } else stats.models
                    val peak = list.maxOfOrNull { if (metric == StatsMetric.TOKENS) it.tokens.totalCount.toDouble() else it.cost.total } ?: 0.0
                    if (list.isEmpty()) {
                        Text("No model activity in this window.", style = MaterialTheme.typography.bodySmall, color = secondary)
                    } else {
                        list.take(15).forEachIndexed { idx, item ->
                            val value = if (metric == StatsMetric.TOKENS) item.tokens.totalCount.toDouble() else item.cost.total
                            val share = if (metric == StatsMetric.TOKENS) {
                                if (stats.totals.tokens.totalCount > 0L) item.tokens.totalCount.toDouble() / stats.totals.tokens.totalCount.toDouble() else 0.0
                            } else {
                                if (stats.totals.cost.total > 0.0) item.cost.total / stats.totals.cost.total else 0.0
                            }
                            val tint = item.harnesses.firstOrNull()?.let { harnessTint(it) } ?: Color(0xFF3B82F6)
                            BreakdownRow(
                                rank = idx + 1,
                                name = item.model,
                                valueText = if (metric == StatsMetric.TOKENS) StatsFormat.tokens(item.tokens.totalCount) else StatsFormat.usd(item.cost.total),
                                subText = "${StatsFormat.percent(share)} · ${StatsFormat.tokens(item.tokens.totalCount)} tokens · ${item.turns} turns",
                                fraction = if (peak > 0.0) (value / peak).toFloat() else 0f,
                                tint = tint,
                            )
                        }
                    }
                }
                BreakdownMode.TIME -> {
                    val list = stats.series.reversed().filter { if (metric == StatsMetric.TOKENS) it.totalTokens > 0L else it.costUsd > 0.0 }
                    val peak = list.maxOfOrNull { if (metric == StatsMetric.TOKENS) it.totalTokens.toDouble() else it.costUsd } ?: 0.0
                    if (list.isEmpty()) {
                        Text("No activity in this window.", style = MaterialTheme.typography.bodySmall, color = secondary)
                    } else {
                        list.take(20).forEachIndexed { idx, pt ->
                            val value = if (metric == StatsMetric.TOKENS) pt.totalTokens.toDouble() else pt.costUsd
                            val hitPart = if (pt.cacheDenom > 0L) " · ${StatsFormat.percent(pt.cacheRead.toDouble() / pt.cacheDenom.toDouble())} cache" else ""
                            val topHarness = pt.byHarness.maxByOrNull { it.costUsd }?.harness
                            val tint = topHarness?.let { harnessTint(it) } ?: Color(0xFF3B82F6)
                            val rowName = pt.label
                            BreakdownRow(
                                rank = idx + 1,
                                name = rowName,
                                valueText = if (metric == StatsMetric.TOKENS) StatsFormat.tokens(pt.totalTokens) else StatsFormat.usd(pt.costUsd),
                                subText = "${StatsFormat.tokens(pt.totalTokens)} tokens · ${pt.turns} turns$hitPart",
                                fraction = if (peak > 0.0) (value / peak).toFloat() else 0f,
                                tint = tint,
                            )
                        }
                    }
                }
                BreakdownMode.PROJECTS -> {
                    val list = if (metric == StatsMetric.TOKENS) stats.projects.sortedByDescending { it.totalTokens } else stats.projects
                    val peak = list.maxOfOrNull { if (metric == StatsMetric.TOKENS) it.totalTokens.toDouble() else it.costUsd } ?: 0.0
                    if (list.isEmpty()) {
                        Text("No project activity in this window.", style = MaterialTheme.typography.bodySmall, color = secondary)
                    } else {
                        list.take(15).forEachIndexed { idx, p ->
                            val value = if (metric == StatsMetric.TOKENS) p.totalTokens.toDouble() else p.costUsd
                            val tint = p.harnesses.firstOrNull()?.let { harnessTint(it) } ?: Color(0xFF3B82F6)
                            val sessWord = if (p.sessions == 1L) "session" else "sessions"
                            BreakdownRow(
                                rank = idx + 1,
                                name = p.name,
                                valueText = if (metric == StatsMetric.TOKENS) StatsFormat.tokens(p.totalTokens) else StatsFormat.usd(p.costUsd),
                                subText = "${p.sessions} $sessWord · ${StatsFormat.tokens(p.totalTokens)} tokens",
                                fraction = if (peak > 0.0) (value / peak).toFloat() else 0f,
                                tint = tint,
                            )
                        }
                    }
                }
                BreakdownMode.AGENTS -> {
                    val peak = stats.subagents.maxOfOrNull { if (metric == StatsMetric.TOKENS) it.totalTokens.toDouble() else it.costUsd } ?: 0.0
                    if (stats.subagents.isEmpty()) {
                        Text("No sub-agent runs in this window.", style = MaterialTheme.typography.bodySmall, color = secondary)
                    } else {
                        stats.subagents.take(15).forEachIndexed { idx, ag ->
                            val value = if (metric == StatsMetric.TOKENS) ag.totalTokens.toDouble() else ag.costUsd
                            val tint = ag.harnesses.firstOrNull()?.let { harnessTint(it) } ?: Color(0xFFA855F7)
                            val fail = if (ag.failures > 0L) " · ${ag.failures} failed" else ""
                            BreakdownRow(
                                rank = idx + 1,
                                name = ag.name,
                                valueText = if (metric == StatsMetric.TOKENS) StatsFormat.tokens(ag.totalTokens) else StatsFormat.usd(ag.costUsd),
                                subText = "${ag.runs} runs · ${StatsFormat.tokens(ag.totalTokens)} tokens$fail",
                                fraction = if (peak > 0.0) (value / peak).toFloat() else 0f,
                                tint = tint,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BreakdownRow(
    rank: Int,
    name: String,
    valueText: String,
    subText: String,
    fraction: Float,
    tint: Color,
) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    val track = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("$rank", style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"), color = secondary, modifier = Modifier.width(20.dp))
            Text(name, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            Text(valueText, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"))
        }
        Box(Modifier.fillMaxWidth().padding(start = 20.dp).height(5.dp).clip(CircleShape).background(track)) {
            if (fraction > 0f) {
                Box(Modifier.fillMaxWidth(fraction.coerceIn(0.02f, 1f)).height(5.dp).background(tint.copy(alpha = 0.78f), CircleShape))
            }
        }
        Text(subText, style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"), color = secondary, modifier = Modifier.padding(start = 20.dp))
    }
}
