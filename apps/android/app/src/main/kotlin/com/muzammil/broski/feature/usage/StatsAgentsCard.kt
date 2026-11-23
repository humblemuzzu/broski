package com.muzammil.broski.feature.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.usage.StatsMetric
import uniffi.broski_contract.StatsHarness
import uniffi.broski_contract.StatsHarnessEntry
import uniffi.broski_contract.StatsSummary

/**
 * Each agent's part of the period: its share in one bar, then a row each. A row narrows the whole
 * tab to that agent and, narrowed, widens it again, as All agents under it does.
 */
@Composable
fun StatsAgentsCard(
    summary: StatsSummary,
    metric: StatsMetric,
    isNarrowed: Boolean,
    onToggle: (StatsHarness) -> Unit,
    onWiden: () -> Unit,
) {
    fun value(entry: StatsHarnessEntry) = if (metric == StatsMetric.COST) entry.costUsd else entry.tokens.totalCount.toDouble()
    val total = if (metric == StatsMetric.COST) summary.totals.cost.total else summary.totals.tokens.totalCount.toDouble()
    StatsSection(stringResource(R.string.stats_agents_title)) {
        if (summary.harnesses.size > 1) {
            ShareBar(summary.harnesses.map { SharePart(value(it), harnessTint(it.harness)) })
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (entry in summary.harnesses) {
                AgentRow(entry, metric, if (total > 0.0) value(entry) / total else 0.0, isNarrowed) { onToggle(entry.harness) }
            }
            if (isNarrowed) {
                Text(
                    stringResource(R.string.stats_agents_all),
                    style = IosText.subheadline,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp).clickable(role = Role.Button, onClick = onWiden),
                )
            }
        }
    }
}

@Composable
private fun AgentRow(entry: StatsHarnessEntry, metric: StatsMetric, share: Double, isNarrowed: Boolean, onClick: () -> Unit) {
    val hint = stringResource(if (isNarrowed) R.string.stats_agents_show_every else R.string.stats_agents_show_only, entry.displayName)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 28.dp).clickable(onClickLabel = hint, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(8.dp).background(harnessTint(entry.harness), CircleShape))
        Text(entry.displayName, style = IosText.body, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text(
            if (metric == StatsMetric.COST) StatsFormat.usd(entry.costUsd) else StatsFormat.tokens(entry.tokens.totalCount),
            style = IosText.body.merge(IosText.tabular),
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            StatsFormat.percent(share),
            style = IosText.footnote.merge(IosText.tabular),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            modifier = Modifier.widthIn(min = 44.dp),
        )
    }
}
