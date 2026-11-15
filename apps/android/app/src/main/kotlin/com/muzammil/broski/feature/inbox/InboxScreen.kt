package com.muzammil.broski.feature.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.MachineStatusChip
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.SectionHeader

/**
 * Every session on every paired Mac, what needs the person first. `onOpenSession` and
 * `onNewSession` are null until Phase 4.2 provides the chat and the New session sheet.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun InboxScreen(
    phone: PhoneSession,
    onOpenMachines: () -> Unit,
    onOpenSession: ((SessionRoute) -> Unit)?,
    onNewSession: (() -> Unit)?,
) {
    val viewModel = viewModel { InboxViewModel(phone) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val pullState = rememberPullToRefreshState()

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeFlexibleTopAppBar(
                title = { Text(stringResource(R.string.nav_inbox)) },
                actions = {
                    IconButton(onClick = onOpenMachines) {
                        Icon(painterResource(R.drawable.ic_computer), contentDescription = stringResource(R.string.inbox_machines))
                    }
                },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = viewModel::refresh,
            state = pullState,
            modifier = Modifier.fillMaxSize().padding(padding),
            indicator = {
                PullToRefreshDefaults.LoadingIndicator(
                    state = pullState,
                    isRefreshing = state.refreshing,
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            },
        ) {
            InboxList(state, viewModel::showWorkingOnly, onOpenSession, onNewSession)
        }
    }
}

@Composable
private fun InboxList(
    state: InboxUiState,
    onWorkingOnly: (Boolean) -> Unit,
    onOpenSession: ((SessionRoute) -> Unit)?,
    onNewSession: (() -> Unit)?,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = if (onNewSession != null) 112.dp else 24.dp),
    ) {
        if (state.mentions.isNotEmpty() || state.working > 0) {
            item(key = "status", contentType = "status") { StatusHeader(state, onWorkingOnly) }
        }
        if (state.isEmpty) {
            item(key = "empty", contentType = "empty") {
                EmptyState(
                    title = stringResource(if (state.anyOnline) R.string.inbox_empty_title else R.string.inbox_waiting_title),
                    body = stringResource(if (state.anyOnline) R.string.inbox_empty_body else R.string.inbox_waiting_body),
                    action = onNewSession?.let { open ->
                        { PrimaryButton(stringResource(R.string.new_session), open, icon = R.drawable.ic_add) }
                    },
                )
            }
        }
        state.sections.forEach { section -> section(section, state, onOpenSession) }
    }
}

private fun LazyListScope.section(
    section: InboxSection,
    state: InboxUiState,
    onOpenSession: ((SessionRoute) -> Unit)?,
) {
    item(key = "section:${section.state}", contentType = "header") {
        SectionHeader(stringResource(section.state.label), Modifier.animateItem())
    }
    itemsIndexed(
        items = section.rows,
        key = { _, row -> "${row.machineId}/${row.session.backend}/${row.session.sessionId}" },
        contentType = { _, _ -> "row" },
    ) { index, row ->
        val motion = MaterialTheme.motionScheme
        InboxRowItem(
            row = row,
            health = state.health[row.machineId],
            shapes = ListItemDefaults.segmentedShapes(index, section.rows.size),
            onOpen = onOpenSession?.let { open -> { open(SessionRoute.of(row.machineId, row.session)) } },
            modifier = Modifier
                .animateItem(
                    fadeInSpec = motion.defaultEffectsSpec(),
                    placementSpec = motion.defaultSpatialSpec(),
                    fadeOutSpec = motion.fastEffectsSpec(),
                )
                .padding(horizontal = 16.dp)
                .padding(bottom = ListItemDefaults.SegmentedGap),
        )
    }
}

@Composable
private fun StatusHeader(state: InboxUiState, onWorkingOnly: (Boolean) -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        state.mentions.forEach { MachineStatusChip(it.health, it.name) }
        if (state.working > 0) {
            ToggleButton(checked = state.workingOnly, onCheckedChange = onWorkingOnly) {
                Text(
                    if (state.workingOnly) {
                        stringResource(R.string.inbox_show_all)
                    } else {
                        pluralStringResource(R.plurals.inbox_working_count, state.working, state.working)
                    },
                )
            }
        }
    }
}
