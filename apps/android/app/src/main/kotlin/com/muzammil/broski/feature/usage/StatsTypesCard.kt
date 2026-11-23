package com.muzammil.broski.feature.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.usage.StatsMetric
import uniffi.broski_contract.StatsTotals

private class TypeKind(val name: Int, val value: Double, val shade: Float)

private class Figure(val value: String, val caption: Int)

/**
 * Where the tokens or the money went by kind, in shades of one ink: cache reads, cache writes, fresh
 * input and output. Then what the cache did: how much of the input it served and what it saved.
 */
@Composable
fun StatsTypesCard(totals: StatsTotals, metric: StatsMetric) {
    val kinds = typeKinds(totals, metric)
    val total = kinds.sumOf { it.value }
    if (total <= 0.0) return
    val ink = MaterialTheme.colorScheme.onSurface
    StatsSection(stringResource(R.string.stats_types_title)) {
        ShareBar(kinds.map { SharePart(it.value, ink.copy(alpha = it.shade)) })
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (kind in kinds) TypeRow(kind, metric, total, ink)
        }
        val figures = figures(totals)
        if (figures.isNotEmpty()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                for (figure in figures) {
                    Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(figure.value, style = IosText.title3.merge(IosText.tabular), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(figure.caption), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun TypeRow(kind: TypeKind, metric: StatsMetric, total: Double, ink: Color) {
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(10.dp).background(ink.copy(alpha = kind.shade), RoundedCornerShape(2.5.dp)))
        Text(stringResource(kind.name), style = IosText.subheadline, modifier = Modifier.weight(1f))
        Text(
            if (metric == StatsMetric.COST) StatsFormat.usd(kind.value) else StatsFormat.tokens(kind.value.toLong()),
            style = IosText.subheadline.merge(IosText.tabular),
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            StatsFormat.percent(kind.value / total),
            style = IosText.footnote.merge(IosText.tabular),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            modifier = Modifier.widthIn(min = 44.dp),
        )
    }
}

private fun typeKinds(totals: StatsTotals, metric: StatsMetric): List<TypeKind> {
    val tokens = totals.tokens
    val cost = totals.cost
    val values = if (metric == StatsMetric.COST) {
        listOf(cost.cacheRead, cost.cacheWrite, cost.input, cost.output)
    } else {
        listOf(tokens.cachedInput.toDouble(), tokens.cacheCreation.toDouble(), tokens.uncachedInput.toDouble(), tokens.output.toDouble())
    }
    val names = listOf(R.string.stats_type_cache_read, R.string.stats_type_cache_write, R.string.stats_type_input, R.string.stats_type_output)
    val shades = listOf(0.22f, 0.42f, 0.64f, 0.9f)
    return values.indices.map { TypeKind(names[it], values[it], shades[it]) }
}

private fun figures(totals: StatsTotals): List<Figure> = buildList {
    totals.tokens.cacheHitRate?.let { add(Figure(StatsFormat.percent(it), R.string.stats_figure_cache_hit)) }
    if (totals.cacheSavingsUsd > 0.0) add(Figure(StatsFormat.usd(totals.cacheSavingsUsd), R.string.stats_figure_cache_saved))
    if (totals.tokens.reasoning > 0L) add(Figure(StatsFormat.tokens(totals.tokens.reasoning), R.string.stats_figure_reasoning))
    if (totals.speedCost.premium > 0.0) add(Figure("+" + StatsFormat.usd(totals.speedCost.premium), R.string.stats_figure_fast))
}.take(3)
