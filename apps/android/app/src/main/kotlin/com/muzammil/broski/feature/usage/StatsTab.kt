package com.muzammil.broski.feature.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.orb.OrbState
import kotlinx.coroutines.launch
import uniffi.broski_contract.StatsSummary

/**
 * Stats: what the agents on the paired Macs used over a period, as tokens or as what the same use
 * would cost at API prices. The period, then the trend with its figure, then the agents, what the
 * use went to and by which kind of token, and a line on where the prices come from.
 */
@Composable
fun StatsTabContent(core: AppCore, phone: PhoneSession) {
    val summary by core.stats.summary.collectAsStateWithLifecycle()
    val range by core.stats.range.collectAsStateWithLifecycle()
    val metric by core.stats.metric.collectAsStateWithLifecycle()
    val selectedHarness by core.stats.selectedHarness.collectAsStateWithLifecycle()
    val isReading by core.stats.isReading.collectAsStateWithLifecycle()
    val machines by phone.machines.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val current = summary

    Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
        Segments(
            options = ORDERED_STATS_RANGES,
            selected = range,
            label = { it.shortName() },
            onSelect = { scope.launch { core.stats.selectRange(it, phone) } },
            modifier = Modifier.fillMaxWidth(),
        )
        when {
            current != null -> {
                StatsTrendCard(current, metric, core.stats::setMetric)
                StatsAgentsCard(
                    summary = current,
                    metric = metric,
                    isNarrowed = selectedHarness != null,
                    onToggle = { scope.launch { core.stats.toggleHarness(it, phone) } },
                    onWiden = { scope.launch { core.stats.clearHarness(phone) } },
                )
                StatsTopCard(current, metric)
                StatsTypesCard(current.totals, metric)
                Footnote(current)
            }
            isReading -> Reading()
            else -> EmptyState(
                title = stringResource(R.string.stats_empty_title),
                body = stringResource(if (machines.any { it.health.isOnline }) R.string.stats_empty_ready else R.string.stats_empty_offline),
                modifier = Modifier.padding(top = 32.dp),
            )
        }
    }
}

@Composable
private fun Reading() {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Orb(OrbState.WORKING, size = 44.dp)
        Text(stringResource(R.string.stats_reading), style = IosText.footnote, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Footnote(summary: StatsSummary) {
    Text(
        statsFootnote(LocalResources.current, summary),
        style = IosText.footnote,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        modifier = Modifier.padding(horizontal = 4.dp),
    )
}
