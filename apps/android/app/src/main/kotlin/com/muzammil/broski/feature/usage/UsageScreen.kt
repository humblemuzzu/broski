package com.muzammil.broski.feature.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.usage.PlanReport
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.relativeTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class UsageSectionTab(val labelRes: Int) {
    STATS(R.string.usage_tab_stats),
    LIMITS(R.string.usage_tab_limits),
}

/** The Usage tab: Stats (left) for cross-agent tokens and cost, and Limits (right) for plan quotas. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun UsageScreen(core: AppCore, phone: PhoneSession) {
    val report by core.usage.report.collectAsStateWithLifecycle()
    val isReadingLimits by core.usage.isReading.collectAsStateWithLifecycle()
    val isReadingStats by core.stats.isReading.collectAsStateWithLifecycle()
    val machines by phone.machines.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    var activeTab by remember { mutableStateOf(UsageSectionTab.STATS) }
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000L)
            nowMs = System.currentTimeMillis()
        }
    }
    val onlineMachineIds = machines.filter { it.health.isOnline }.map { it.id }
    LaunchedEffect(phone, onlineMachineIds) {
        if (onlineMachineIds.isEmpty()) return@LaunchedEffect
        core.stats.refresh(phone)
        core.usage.refresh(phone)
    }
    LaunchedEffect(activeTab, phone) {
        if (activeTab == UsageSectionTab.STATS) core.stats.refresh(phone)
        else core.usage.refresh(phone)
    }

    val isRefreshing = if (activeTab == UsageSectionTab.STATS) isReadingStats else isReadingLimits

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { LargeFlexibleTopAppBar(title = { Text(stringResource(R.string.usage_title)) }, scrollBehavior = scrollBehavior) },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = {
                scope.launch {
                    if (activeTab == UsageSectionTab.STATS) core.stats.refresh(phone, force = true)
                    else core.usage.refresh(phone, force = true)
                }
            },
            modifier = Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = padding.calculateBottomPadding() + 96.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "section-switcher") {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        UsageSectionTab.entries.forEachIndexed { idx, tab ->
                            SegmentedButton(
                                selected = activeTab == tab,
                                onClick = { activeTab = tab },
                                shape = SegmentedButtonDefaults.itemShape(index = idx, count = UsageSectionTab.entries.size),
                            ) {
                                Text(stringResource(tab.labelRes))
                            }
                        }
                    }
                }

                if (activeTab == UsageSectionTab.STATS) {
                    item(key = "stats-content") {
                        StatsTabContent(core = core, phone = phone)
                    }
                } else {
                    val plans = report?.plans.orEmpty()
                    if (plans.isEmpty()) {
                        item(key = "limits-empty") {
                            EmptyState(
                                title = stringResource(R.string.usage_empty_title),
                                body = stringResource(if (machines.any { it.health.isOnline }) R.string.usage_empty_ready else R.string.usage_empty_offline),
                                modifier = Modifier.fillMaxWidth().padding(top = 48.dp),
                            )
                        }
                    } else {
                        plans.forEach { plan ->
                            item(key = "plan:${plan.plan}") {
                                PlanHeader(plan, nowMs, showsMachine = machines.size > 1, Modifier.padding(top = 12.dp))
                            }
                            items(plan.orderedWindows, key = { "${plan.plan}:${it.id}" }) { window ->
                                LimitCard(plan.plan, window, nowMs)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A plan: its mark, name and tier, when it was read, and why the last read failed when it did. */
@Composable
private fun PlanHeader(report: PlanReport, nowMs: Long, showsMachine: Boolean, modifier: Modifier) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier.padding(horizontal = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PlanGlyph(report.plan, report.name)
            Text(report.name, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            val detail = listOfNotNull(report.tier, report.machineName.takeIf { showsMachine }).joinToString(" · ")
            if (detail.isNotEmpty()) {
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            }
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
                report.readAtMs?.let {
                    Text(
                        relativeTime(it),
                        style = MaterialTheme.typography.labelMedium,
                        color = if (report.isStale(nowMs)) BroskiTheme.semantic.caution else secondary,
                    )
                }
            }
        }
        report.problem?.let { problem ->
            Text(problem, style = MaterialTheme.typography.bodySmall, color = BroskiTheme.semantic.caution, modifier = Modifier.padding(top = 4.dp))
        }
    }
}
