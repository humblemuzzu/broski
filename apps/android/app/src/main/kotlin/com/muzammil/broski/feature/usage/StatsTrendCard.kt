package com.muzammil.broski.feature.usage

import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.usage.StatsBuckets
import com.muzammil.broski.core.usage.StatsMetric
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import uniffi.broski_contract.StatsSummary

/**
 * The period at a glance: what it came to, how that compares with the period before, and the chart
 * beneath it. A finger on the chart reads one bar into the figure above it.
 */
@Composable
fun StatsTrendCard(summary: StatsSummary, metric: StatsMetric, onMetric: (StatsMetric) -> Unit) {
    val resources = LocalResources.current
    val buckets = remember(summary.series, summary.resolution) { StatsBuckets(summary.series, summary.resolution) }
    var touched by remember(buckets) { mutableStateOf<Int?>(null) }
    val picked = touched?.let { buckets.buckets.getOrNull(it) }
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(picked?.start) { if (picked != null) haptics.perform(Haptic.PickerStep) }
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant

    StatsCard(Modifier.animateContentSize(), Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Crossfade(trendCaption(resources, summary, metric, picked, buckets.unit), Modifier.weight(1f), label = "caption") {
                Text(it, style = IosText.subheadline, fontWeight = FontWeight.Medium, color = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Segments(
                options = StatsMetric.entries,
                selected = metric,
                label = { stringResource(if (it == StatsMetric.COST) R.string.stats_metric_cost else R.string.stats_metric_tokens) },
                onSelect = onMetric,
                modifier = Modifier.width(136.dp),
                compact = true,
            )
        }
        NumericText(trendFigure(summary, metric, picked), IosText.figure)
        Crossfade(trendDetail(resources, summary, metric, picked), label = "detail") {
            Text(it, style = IosText.footnote.merge(IosText.tabular), color = secondary, maxLines = 2)
        }
        StatsTrendChart(buckets, metric, touched, { touched = it }, Modifier.padding(top = 16.dp))
    }
}
