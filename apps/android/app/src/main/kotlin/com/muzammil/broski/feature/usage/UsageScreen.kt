package com.muzammil.broski.feature.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
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
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.LocalTabBarClearance
import com.muzammil.broski.design.SoftTopBar
import com.muzammil.broski.design.orb.OrbState
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
    val isReadingLimits by core.usage.isReading.collectAsStateWithLifecycle()
    val isReadingStats by core.stats.isReading.collectAsStateWithLifecycle()
    val machines by phone.machines.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var activeTab by remember { mutableStateOf(UsageSectionTab.STATS) }
    var pulling by remember { mutableStateOf(false) }
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

    val isReading = if (activeTab == UsageSectionTab.STATS) isReadingStats else isReadingLimits
    val top = titleBarInset()
    val pullState = rememberPullToRefreshState()
    val haptics = LocalHapticFeedback.current
    Box(Modifier.fillMaxSize().background(Grouped.screen)) {
        PullToRefreshBox(
            isRefreshing = pulling,
            onRefresh = {
                haptics.perform(Haptic.Refresh)
                pulling = true
                scope.launch {
                    if (activeTab == UsageSectionTab.STATS) core.stats.refresh(phone, force = true)
                    else core.usage.refresh(phone, force = true)
                    pulling = false
                }
            },
            state = pullState,
            modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.LoadingIndicator(
                    state = pullState,
                    isRefreshing = pulling,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = top),
                )
            },
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = top + 8.dp, bottom = 32.dp + LocalTabBarClearance.current),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item(key = "section-switcher") {
                    Segments(
                        options = UsageSectionTab.entries,
                        selected = activeTab,
                        label = { stringResource(it.labelRes) },
                        onSelect = { activeTab = it },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (activeTab == UsageSectionTab.STATS) {
                    item(key = "stats-content") { StatsTabContent(core = core, phone = phone) }
                } else {
                    limitsContent(core, machines, nowMs)
                }
            }
        }
        SoftTopBar(Grouped.screen) {
            ScreenTitleBar(stringResource(R.string.usage_title)) {
                if (isReading) LoadingOrb(state = OrbState.WORKING, label = stringResource(R.string.usage_reading))
            }
        }
    }
}
