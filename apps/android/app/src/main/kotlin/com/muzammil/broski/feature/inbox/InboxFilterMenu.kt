package com.muzammil.broski.feature.inbox

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.InboxFilter
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import uniffi.broski_core.InboxRow
import uniffi.broski_core.InboxState

/** The most recent folders the menu offers first, newest first; the rest are under More projects. */
private const val RECENT_FOLDERS = 8

/**
 * The inbox's one filter control: a button in the bar, filled while a filter is on, opening a menu:
 * working sessions only, then the agents the Macs run, the folders sessions ran in lately, and the
 * Macs once there are two, each a list whose choice carries a check.
 */
@Composable
fun InboxFilterMenu(state: InboxUiState, onFilter: (InboxFilter) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var allFolders by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val filter = state.filter
    val set = { next: InboxFilter ->
        if (next != filter) {
            haptics.perform(Haptic.PickerStep)
            onFilter(next)
        }
    }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(
                painterResource(if (filter.isActive) R.drawable.ic_filter_on else R.drawable.ic_filter),
                contentDescription = stringResource(if (filter.isActive) R.string.inbox_filters_on else R.string.inbox_filters),
                modifier = Modifier.size(22.dp),
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Choice(stringResource(R.string.inbox_filter_working_only), filter.state == InboxState.WORKING) {
                set(filter.copy(state = if (filter.state == InboxState.WORKING) null else InboxState.WORKING))
            }
            val agents = agents(state.machines)
            if (agents.size > 1) {
                Heading(R.string.inbox_filter_agent)
                Choice(stringResource(R.string.inbox_filter_all_agents), filter.backend == null) { set(filter.copy(backend = null)) }
                agents.forEach { agent -> Choice(agent.name, filter.backend == agent.id) { set(filter.copy(backend = agent.id)) } }
            }
            Heading(R.string.inbox_filter_project)
            Choice(stringResource(R.string.inbox_filter_all_projects), filter.folder == null) { set(filter.copy(folder = null)) }
            val folders = folderChoices(state.rows, filter.folder)
            folders.recent.forEach { folder ->
                Choice(folder.lastComponent, filter.folder == folder) { set(filter.copy(folder = folder)) }
            }
            if (folders.others.isNotEmpty()) {
                DropdownMenuItem(
                    text = { Text(stringResource(if (allFolders) R.string.inbox_filter_fewer_projects else R.string.inbox_filter_more_projects)) },
                    onClick = { allFolders = !allFolders },
                )
                if (allFolders) {
                    folders.others.forEach { folder ->
                        Choice(folder.lastComponent, filter.folder == folder) { set(filter.copy(folder = folder)) }
                    }
                }
            }
            if (state.machines.size > 1) {
                Heading(R.string.inbox_filter_mac)
                Choice(stringResource(R.string.inbox_filter_all_macs), filter.machineId == null) { set(filter.copy(machineId = null)) }
                state.machines.forEach { mac -> Choice(mac.name, filter.machineId == mac.id) { set(filter.copy(machineId = mac.id)) } }
            }
            if (filter.isActive) {
                HorizontalDivider()
                DropdownMenuItem(text = { Text(stringResource(R.string.inbox_filter_clear)) }, onClick = {
                    open = false
                    set(InboxFilter())
                })
            }
        }
    }
}

@Composable
private fun Heading(label: Int) {
    HorizontalDivider()
    Text(
        stringResource(label),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 4.dp),
    )
}

@Composable
private fun Choice(label: String, chosen: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, maxLines = 1) },
        onClick = onClick,
        trailingIcon = if (chosen) ({ Icon(painterResource(R.drawable.ic_check), contentDescription = null, modifier = Modifier.size(18.dp)) }) else null,
    )
}

/** Every agent the paired Macs run, once each, in the Macs' order. */
private fun agents(machines: List<MachineState>): List<Agent> =
    machines.flatMap { machine -> machine.agents.map { it.agent } }.distinctBy { it.id }

private class FolderChoices(val recent: List<String>, val others: List<String>)

/**
 * The folders sessions ran in: the most recent first, the chosen one among them even once it is older, and the
 * rest by name. One pass over the rows, which may be thousands.
 */
private fun folderChoices(rows: List<InboxRow>, chosen: String?): FolderChoices {
    val newest = HashMap<String, Long>()
    for (row in rows) {
        val cwd = row.cwd ?: continue
        newest[cwd] = maxOf(newest[cwd] ?: Long.MIN_VALUE, row.updatedAt)
    }
    val byRecency = newest.entries.sortedByDescending { it.value }.map { it.key }
    val recent = byRecency.take(RECENT_FOLDERS).let { if (chosen == null || chosen in it) it else listOf(chosen) + it }
    val others = byRecency.drop(RECENT_FOLDERS).filter { it != chosen }.sortedBy { it.lastComponent.lowercase() }
    return FolderChoices(recent, others)
}

private val String.lastComponent: String get() = trimEnd('/').substringAfterLast('/').ifEmpty { this }

/** What the inbox is narrowed to, for the bar's leading edge: "Working · Pi · broski". */
@Composable
fun InboxFilter.summary(machines: List<MachineState>): String? {
    val agent = backend?.let { id -> agents(machines).firstOrNull { it.id == id }?.name ?: Agent.known(id).name }
    val mac = machineId?.let { id -> machines.firstOrNull { it.id == id }?.name }
    val parts = listOfNotNull(state?.let { stringResource(it.label) }, agent, mac, folder?.lastComponent)
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}
