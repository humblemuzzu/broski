package com.muzammil.broski.feature.usage

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.usage.StatsMetric
import uniffi.broski_contract.StatsSummary

private const val SHOWN = 5

private enum class TopKind(val label: Int) {
    Models(R.string.stats_top_models),
    Projects(R.string.stats_top_projects),
    Subagents(R.string.stats_top_subagents),
}

private class TopItem(val id: String, val name: String, val costUsd: Double, val tokens: Long, val count: String, val tint: Color) {
    fun value(metric: StatsMetric) = if (metric == StatsMetric.COST) costUsd else tokens.toDouble()
}

/**
 * What the period went to: its models, its projects or its sub-agents, the largest five with a bar
 * each against the first, the rest a tap away.
 */
@Composable
fun StatsTopCard(summary: StatsSummary, metric: StatsMetric) {
    val byKind = TopKind.entries.associateWith { topItems(summary, it, metric) }.filterValues { it.isNotEmpty() }
    var chosen by rememberSaveable { mutableStateOf(TopKind.Models) }
    var showsAll by rememberSaveable { mutableStateOf(false) }
    if (byKind.isEmpty()) return
    val kind = chosen.takeIf { it in byKind } ?: byKind.keys.first()
    val all = byKind.getValue(kind)
    val peak = all.first().value(metric)
    StatsSection(stringResource(R.string.stats_top_title), Modifier.animateContentSize()) {
        if (byKind.size > 1) {
            Segments(byKind.keys.toList(), kind, { stringResource(it.label) }, { chosen = it; showsAll = false }, Modifier.fillMaxWidth())
        }
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            for (item in if (showsAll) all else all.take(SHOWN)) TopRow(item, metric, if (peak > 0.0) item.value(metric) / peak else 0.0)
        }
        if (all.size > SHOWN) {
            Text(
                stringResource(if (showsAll) R.string.stats_top_show_fewer else R.string.stats_top_show_all, all.size),
                style = IosText.subheadline,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable(role = Role.Button) { showsAll = !showsAll },
            )
        }
    }
}

@Composable
private fun TopRow(item: TopItem, metric: StatsMetric, fraction: Double) {
    val other = if (metric == StatsMetric.COST) stringResource(R.string.stats_tokens_count, StatsFormat.tokens(item.tokens)) else StatsFormat.usd(item.costUsd)
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                item.name,
                style = IosText.subheadline,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
                modifier = Modifier.weight(1f).alignByBaseline(),
            )
            Text(
                if (metric == StatsMetric.COST) StatsFormat.usd(item.costUsd) else StatsFormat.tokens(item.tokens),
                style = IosText.subheadline.merge(IosText.tabular),
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.alignByBaseline(),
            )
        }
        Meter(fraction, item.tint)
        Text(stringResource(R.string.stats_top_detail, other, item.count), style = IosText.caption.merge(IosText.tabular), color = secondary)
    }
}

@Composable
private fun topItems(summary: StatsSummary, kind: TopKind, metric: StatsMetric): List<TopItem> {
    val resources = LocalResources.current
    val neutral = MaterialTheme.colorScheme.onSurfaceVariant
    val items = when (kind) {
        TopKind.Models -> summary.models.map {
            TopItem("${it.provider}/${it.model}", it.model, it.cost.total, it.tokens.totalCount, resources.turns(it.turns), it.harnesses.firstOrNull()?.let { h -> harnessTint(h) } ?: neutral)
        }
        TopKind.Projects -> summary.projects.map {
            TopItem(it.id, it.name, it.costUsd, it.totalTokens, resources.sessions(it.sessions), it.harnesses.firstOrNull()?.let { h -> harnessTint(h) } ?: neutral)
        }
        TopKind.Subagents -> summary.subagents.map {
            val failed = if (it.failures > 0L) " · " + resources.getString(R.string.stats_failed, it.failures.toString()) else ""
            TopItem(it.name, it.name, it.costUsd, it.totalTokens, resources.runs(it.runs) + failed, it.harnesses.firstOrNull()?.let { h -> harnessTint(h) } ?: neutral)
        }
    }
    return items.filter { it.value(metric) > 0.0 }.sortedByDescending { it.value(metric) }
}
