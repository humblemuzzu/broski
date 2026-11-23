package com.muzammil.broski.feature.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.core.InboxFilter
import com.muzammil.broski.core.InboxFilters
import com.muzammil.broski.core.MachineHealth
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.MachineStatusChip
import com.muzammil.broski.design.SoftTopBar
import com.muzammil.broski.design.perform

private val BarHeight = 56.dp

/** Room under the list for the floating tab bar. */
private val TabBarClearance = 120.dp

/**
 * Home: every session on every paired Mac, needs you → pinned → working → done → idle, under the
 * status of any Mac that is not fine. Idle sessions fold under their header whenever anything else
 * is listed. No drawn title: the bar holds what the filter narrows the inbox to, the filter button and
 * the search button, which turns the bar into a search field. New session is the tab bar's.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun InboxScreen(
    phone: PhoneSession,
    filters: InboxFilters,
    onOpenSession: ((SessionRoute) -> Unit)?,
    onNewSession: (() -> Unit)?,
) {
    val viewModel = viewModel { InboxViewModel(phone, filters) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    AnswerFeedback(viewModel, snackbar)
    LostMachineHaptic(state)
    var searching by rememberSaveable { mutableStateOf(false) }
    val closeSearch = {
        viewModel.search("")
        searching = false
    }
    BackHandler(enabled = searching, onBack = closeSearch)
    var idleOpen by rememberSaveable { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(state.onlyIdle) { if (state.onlyIdle && idleOpen == null) idleOpen = true }
    val idleShown = idleOpen ?: state.query.isNotEmpty()
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + BarHeight
    val pullState = rememberPullToRefreshState()

    Box(Modifier.fillMaxSize().background(Grouped.screen)) {
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = viewModel::refresh,
            state = pullState,
            modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.LoadingIndicator(
                    state = pullState,
                    isRefreshing = state.refreshing,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = top),
                )
            },
        ) {
            InboxList(state, viewModel, idleShown, { idleOpen = !idleShown }, onOpenSession, PaddingValues(top = top, bottom = TabBarClearance))
            if (state.isEmpty) {
                InboxEmptyState(
                    state = state,
                    onClear = { viewModel.setFilter(InboxFilter()) },
                    onShowAllStates = { viewModel.setFilter(state.filter.copy(state = null)) },
                    onNewSession = onNewSession,
                    modifier = Modifier.padding(top = top + 48.dp),
                )
            }
        }
        SoftTopBar(Grouped.screen) {
            InboxBar(state, searching, onSearch = { searching = true }, onQuery = viewModel::search, onClose = closeSearch, onFilter = viewModel::setFilter)
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = TabBarClearance))
    }
}

@Composable
private fun InboxBar(
    state: InboxUiState,
    searching: Boolean,
    onSearch: () -> Unit,
    onQuery: (String) -> Unit,
    onClose: () -> Unit,
    onFilter: (InboxFilter) -> Unit,
) {
    val motion = MaterialTheme.motionScheme
    AnimatedContent(
        targetState = searching,
        transitionSpec = { fadeIn(motion.fastEffectsSpec()) togetherWith fadeOut(motion.fastEffectsSpec()) },
        modifier = Modifier.fillMaxWidth().height(BarHeight).padding(horizontal = Grouped.margin),
        contentAlignment = Alignment.CenterStart,
        label = "bar",
    ) { open ->
        if (open) {
            InboxSearchField(state.query, onQuery, onClose)
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                val summary = state.filter.summary(state.machines)
                Box(Modifier.weight(1f)) {
                    if (summary != null) {
                        val showing = stringResource(R.string.inbox_showing, summary)
                        Text(
                            summary,
                            style = inboxToneStyle,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.semantics { contentDescription = showing },
                        )
                    }
                }
                GlassSurface(shape = CircleShape) {
                    Row(Modifier.height(44.dp).padding(horizontal = 2.dp), horizontalArrangement = Arrangement.spacedBy(0.dp), verticalAlignment = Alignment.CenterVertically) {
                        InboxFilterMenu(state, onFilter)
                        IconButton(onClick = onSearch) {
                            Icon(painterResource(R.drawable.ic_search), contentDescription = stringResource(R.string.inbox_search), modifier = Modifier.size(22.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InboxList(
    state: InboxUiState,
    viewModel: InboxViewModel,
    idleShown: Boolean,
    onToggleIdle: () -> Unit,
    onOpenSession: ((SessionRoute) -> Unit)?,
    padding: PaddingValues,
) {
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = padding) {
        if (state.mentions.isNotEmpty()) {
            item(key = "chips", contentType = "chips") {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = Grouped.margin),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 4.dp),
                ) {
                    items(state.mentions, key = { it.id }) { MachineStatusChip(it.health, it.name) }
                }
            }
        }
        state.sections.forEach { section -> section(section, state, viewModel, idleShown, onToggleIdle, onOpenSession) }
    }
}

private fun LazyListScope.section(
    section: InboxSection,
    state: InboxUiState,
    viewModel: InboxViewModel,
    idleShown: Boolean,
    onToggleIdle: () -> Unit,
    onOpenSession: ((SessionRoute) -> Unit)?,
) {
    val idle = section.group == InboxGroup.IDLE
    item(key = "section:${section.group}", contentType = "header") {
        if (idle) {
            IdleHeader(section.rows.size, idleShown, onToggleIdle, Modifier.animateItem())
        } else {
            InboxSectionHeader(
                title = stringResource(section.group.label),
                count = section.rows.size,
                modifier = Modifier.animateItem(),
                onMarkAllRead = if (section.group == InboxGroup.DONE) viewModel::markAllSeen else null,
            )
        }
    }
    if (idle && !idleShown) return
    itemsIndexed(items = section.rows, key = { _, row -> row.key }, contentType = { _, _ -> "row" }) { index, row ->
        val motion = MaterialTheme.motionScheme
        InboxRowItem(
            row = row,
            agent = state.agent(row),
            health = state.health[row.machineId],
            showsMachine = state.machines.size > 1,
            index = index,
            count = section.rows.size,
            onOpen = onOpenSession?.let { open -> { open(SessionRoute.of(row.machineId, row.session)) } },
            busy = row.key in state.answering,
            pinned = state.pinned(row),
            muted = state.muted(row),
            onAnswer = { decision -> viewModel.answer(row, decision) },
            onAction = { action -> viewModel.act(row, action) },
            modifier = Modifier.animateItem(
                fadeInSpec = motion.defaultEffectsSpec(),
                placementSpec = motion.defaultSpatialSpec(),
                fadeOutSpec = motion.fastEffectsSpec(),
            ),
        )
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

/** The failure haptic when a Mac's link is lost or refused, as iOS plays it. */
@Composable
private fun LostMachineHaptic(state: InboxUiState) {
    val haptics = LocalHapticFeedback.current
    val lost = state.machines.count { machine ->
        when (machine.health) {
            is MachineHealth.BridgeDown, is MachineHealth.Incompatible, is MachineHealth.Refused, MachineHealth.Revoked, MachineHealth.Ended -> true
            else -> false
        }
    }
    var last by remember { mutableStateOf(lost) }
    LaunchedEffect(lost) {
        if (lost > last) haptics.perform(Haptic.Failure)
        last = lost
    }
}
