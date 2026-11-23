package com.muzammil.broski.feature.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.core.usage.PlanReport
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.relativeTime

/** Limits: each signed-in plan with its quota windows, 32 dp apart, or why there is none. */
fun LazyListScope.limitsContent(core: AppCore, machines: List<MachineState>, nowMs: Long) {
    item(key = "limits") {
        val report by core.usage.report.collectAsStateWithLifecycle()
        val plans = report?.plans.orEmpty()
        if (plans.isEmpty()) {
            EmptyState(
                title = stringResource(R.string.usage_plans_empty_title),
                body = stringResource(if (machines.any { it.health.isOnline }) R.string.usage_plans_empty_ready else R.string.usage_plans_empty_offline),
                modifier = Modifier.padding(top = 32.dp),
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(32.dp)) {
                for (plan in plans) PlanSection(plan, nowMs, showsMachine = machines.size > 1)
            }
        }
    }
}

/** One plan: its mark, name and tier, when it was read, why the last read failed if it did, then its limits. */
@Composable
private fun PlanSection(report: PlanReport, nowMs: Long, showsMachine: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PlanHeader(report, nowMs, showsMachine)
        report.problem?.let { problem ->
            Row(
                Modifier.padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(painterResource(R.drawable.ic_warning), contentDescription = null, tint = BroskiTheme.semantic.caution, modifier = Modifier.size(14.dp))
                Text(problem, style = IosText.footnote, color = BroskiTheme.semantic.caution)
            }
        }
        for (window in report.orderedWindows) LimitCard(report.plan, window, nowMs)
    }
}

@Composable
private fun PlanHeader(report: PlanReport, nowMs: Long, showsMachine: Boolean) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    val detail = listOfNotNull(report.tier, report.machineName.takeIf { showsMachine }).joinToString(" · ")
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PlanGlyph(report.plan, report.name, 20.dp)
        Text(report.name, style = IosText.title3, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        if (detail.isNotEmpty()) {
            Text(detail, style = IosText.subheadline, color = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
            report.readAtMs?.let {
                Text(
                    relativeTime(it),
                    style = IosText.footnote,
                    color = if (report.isStale(nowMs)) BroskiTheme.semantic.caution else secondary.copy(alpha = 0.6f),
                    maxLines = 1,
                )
            }
        }
    }
}
