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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
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
import com.muzammil.broski.design.Notice
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.QuietButton
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.perform

/**
 * Every session on every paired Mac, what needs the person first. The Macs themselves are in
 * Settings; New session is the navigation bar's floating action.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun InboxScreen(
    phone: PhoneSession,
    onOpenSession: ((SessionRoute) -> Unit)?,
    onNewSession: (() -> Unit)?,
    onOpenScreen: ((String) -> Unit)? = null,
) {
    val viewModel = viewModel { InboxViewModel(phone) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val pullState = rememberPullToRefreshState()
    val snackbar = remember { SnackbarHostState() }
    AnswerFeedback(viewModel, snackbar)

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            LargeFlexibleTopAppBar(
                title = { Text(stringResource(R.string.nav_inbox)) },
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
            InboxList(state, viewModel, onOpenSession, onNewSession, onOpenScreen)
        }
    }
}

/** Each answer from a row: its haptic, and a word when it did not go through. */
@Composable
private fun AnswerFeedback(viewModel: InboxViewModel, snackbar: SnackbarHostState) {
    val haptics = LocalHapticFeedback.current
    val resources = LocalResources.current
    LaunchedEffect(viewModel) {
        viewModel.answers.collect { answer ->
            haptics.perform(answer.haptic)
            val notice = when (val result = answer.result) {
                RowAnswer.Result.Sent -> null
                RowAnswer.Result.Stale -> resources.getString(R.string.inbox_answered_elsewhere)
                is RowAnswer.Result.Failed -> resources.getString(R.string.inbox_answer_failed, result.detail)
            }
            notice?.let { snackbar.showSnackbar(it) }
        }
    }
}

@Composable
private fun InboxList(
    state: InboxUiState,
    viewModel: InboxViewModel,
    onOpenSession: ((SessionRoute) -> Unit)?,
    onNewSession: (() -> Unit)?,
    onOpenScreen: ((String) -> Unit)?,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = if (onNewSession != null) 96.dp else 24.dp),
    ) {
        if (state.mentions.isNotEmpty() || state.working > 0) {
            item(key = "status", contentType = "status") { StatusHeader(state, viewModel::showWorkingOnly) }
        }
        state.machines.filter { it.macDialogs.isNotEmpty() }.forEach { machine ->
            item(key = "mac-dialogs:${machine.id}", contentType = "notice") {
                val body = if (machine.macDialogs.size == 1) {
                    machine.macDialogs.first().title
                } else {
                    stringResource(R.string.screen_dialogs_count, machine.macDialogs.size)
                }
                Notice(
                    icon = R.drawable.ic_warning,
                    title = stringResource(R.string.screen_dialog_banner_title, machine.name),
                    body = body,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    action = onOpenScreen?.let { open ->
                        { QuietButton(stringResource(R.string.screen_open_button), { open(machine.id) }) }
                    },
                )
            }
        }
        if (state.isEmpty) {
            item(key = "empty", contentType = "empty") {
                EmptyState(
                    title = stringResource(if (state.anyOnline) R.string.inbox_empty_title else R.string.inbox_waiting_title),
                    body = stringResource(if (state.anyOnline) R.string.inbox_empty_body else R.string.inbox_waiting_body),
                    leading = if (state.connecting && !state.anyOnline) ({ Orb(OrbState.CONNECTING, size = 64.dp) }) else null,
                    action = onNewSession?.let { open ->
                        { PrimaryButton(stringResource(R.string.new_session), open, icon = R.drawable.ic_add) }
                    },
                )
            }
        }
        state.sections.forEach { section -> section(section, state, viewModel, onOpenSession) }
    }
}

private fun LazyListScope.section(
    section: InboxSection,
    state: InboxUiState,
    viewModel: InboxViewModel,
    onOpenSession: ((SessionRoute) -> Unit)?,
) {
    item(key = "section:${section.group}", contentType = "header") {
        SectionHeader(
            text = stringResource(section.group.label),
            modifier = Modifier.animateItem(),
            action = if (section.group == InboxGroup.DONE) {
                { TextButton(onClick = viewModel::markAllSeen) { Text(stringResource(R.string.inbox_mark_all_read)) } }
            } else {
                null
            },
        )
    }
    itemsIndexed(
        items = section.rows,
        key = { _, row -> row.key },
        contentType = { _, _ -> "row" },
    ) { index, row ->
        val motion = MaterialTheme.motionScheme
        InboxRowItem(
            row = row,
            agent = state.agent(row),
            health = state.health[row.machineId],
            showsMachine = state.machines.size > 1,
            shapes = ListItemDefaults.segmentedShapes(index, section.rows.size),
            onOpen = onOpenSession?.let { open -> { open(SessionRoute.of(row.machineId, row.session)) } },
            busy = row.key in state.answering,
            pinned = state.pinned(row),
            muted = state.muted(row),
            onAnswer = { decision -> viewModel.answer(row, decision) },
            onAction = { action -> viewModel.act(row, action) },
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
