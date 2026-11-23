package com.muzammil.broski.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.LocalTabBarClearance
import com.muzammil.broski.feature.inbox.InboxScreen
import com.muzammil.broski.feature.machines.MachinesScreen
import com.muzammil.broski.feature.pairing.PairScreen
import com.muzammil.broski.feature.settings.AboutScreen
import com.muzammil.broski.feature.settings.AppearanceScreen
import com.muzammil.broski.feature.settings.DeveloperScreen
import com.muzammil.broski.feature.settings.NotificationSettingsScreen
import com.muzammil.broski.feature.settings.SettingsScreen
import com.muzammil.broski.feature.settings.VoiceSettingsScreen
import com.muzammil.broski.feature.usage.UsageScreen
import com.muzammil.broski.feature.workspace.workspaceEntries
import uniffi.broski_core.InboxState

/**
 * The app once a Mac is paired: one [NavDisplay], which gives every screen predictive back, under the
 * floating tab bar with New Session beside it. The bar leaves with the chat, New Session, and any
 * screen the chat opens (files, git, a terminal), as iOS hides it there; while agents work, a capsule
 * above it opens the inbox narrowed to them, wherever the bar shows the inbox's list or another tab.
 */
@Composable
fun Shell(core: AppCore, phone: PhoneSession, features: Features, openRequests: OpenRequests) {
    val navigator = rememberNavigator()
    OpenRequested(openRequests, phone, features, navigator)
    val machines by phone.machines.collectAsStateWithLifecycle()
    val rows by phone.inboxRows.collectAsStateWithLifecycle(initialValue = emptyList())
    val needsYou = rows.count { it.state == InboxState.NEEDS_YOU }
    val working = rows.count { it.state == InboxState.WORKING }
    val onlineCount = machines.count { it.health.isOnline }
    LaunchedEffect(phone, onlineCount) {
        if (onlineCount > 0) core.usage.refresh(phone)
    }
    val context = remember(phone, navigator) { FeatureContext(phone, navigator::open, navigator::back) }
    val barShown = navigator.shown.none { it.hidesTabBar }
    val workingShown = barShown && working > 0 && (navigator.tab != TopLevel.Inbox || navigator.shown.size == 1)
    val clearance = if (barShown) tabBarClearance(workingShown) else 0.dp
    val newSession = features.newSession?.let {
        {
            if (navigator.tab != TopLevel.Inbox) navigator.select(TopLevel.Inbox)
            navigator.open(NewSessionRoute)
        }
    }

    Box(Modifier.fillMaxSize()) {
        CompositionLocalProvider(LocalTabBarClearance provides clearance) {
            NavDisplay(
                backStack = navigator.entries,
                onBack = navigator::back,
                entryDecorators = listOf(
                    rememberSaveableStateHolderNavEntryDecorator(),
                    rememberViewModelStoreNavEntryDecorator(),
                ),
                entryProvider = entryProvider { shellEntries(core, context, features, navigator) },
            )
        }
        AnimatedVisibility(
            visible = barShown,
            enter = fadeIn() + slideInVertically { it },
            exit = fadeOut() + slideOutVertically { it },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            FloatingTabBar(
                selected = navigator.tab,
                onSelect = navigator::select,
                needsYou = needsYou,
                working = if (workingShown) working else 0,
                onWorking = {
                    if (navigator.tab != TopLevel.Inbox) navigator.select(TopLevel.Inbox)
                    core.inboxFilters.update { it.copy(state = InboxState.WORKING) }
                },
                onNewSession = newSession,
            )
        }
    }
}

/** The chat and what it opens draw their own bottom edge (a composer, a key row): no tab bar there. */
private val Route.hidesTabBar: Boolean
    get() = this is SessionRoute || this == NewSessionRoute || this is FilesRoute || this is FileRoute ||
        this is GitRoute || this is DiffRoute || this is TerminalRoute

/**
 * What a notification or a widget asked for: a session's chat once it exists and the machine is
 * still paired, else the inbox it is listed in; the Usage tab.
 */
@Composable
private fun OpenRequested(openRequests: OpenRequests, phone: PhoneSession, features: Features, navigator: Navigator) {
    val requested by openRequests.next.collectAsStateWithLifecycle()
    val pairLink by openRequests.pairLink.collectAsStateWithLifecycle()
    LaunchedEffect(pairLink) {
        if (pairLink != null && navigator.entries.lastOrNull() != PairRoute) navigator.open(PairRoute)
    }
    LaunchedEffect(requested) {
        val route = requested ?: return@LaunchedEffect
        when (route) {
            is SessionRoute -> {
                if (navigator.tab != TopLevel.Inbox) navigator.select(TopLevel.Inbox)
                if (features.session != null && phone.machine(route.machineId) != null) navigator.open(route)
            }
            UsageRoute -> if (navigator.tab != TopLevel.Usage) navigator.select(TopLevel.Usage)
            else -> Unit
        }
        openRequests.taken(route)
    }
}

private fun EntryProviderScope<Route>.shellEntries(
    core: AppCore,
    context: FeatureContext,
    features: Features,
    navigator: Navigator,
) {
    val phone = context.phone
    entry<InboxRoute> {
        InboxScreen(
            phone = phone,
            filters = core.inboxFilters,
            onOpenSession = features.session?.let { { route -> navigator.open(route) } },
            onNewSession = features.newSession?.let { { navigator.open(NewSessionRoute) } },
        )
    }
    entry<UsageRoute> { UsageScreen(core = core, phone = phone) }
    entry<MachinesRoute> {
        MachinesScreen(phone = phone, onBack = navigator::back, onPairAnother = { navigator.open(PairRoute) })
    }
    entry<PairRoute> { PairScreen(phone = phone, onBack = navigator::back, onPaired = navigator::back) }
    entry<SettingsRoute> { SettingsScreen(core = core, phone = phone, open = navigator::open) }
    entry<NotificationSettingsRoute> { NotificationSettingsScreen(core = core, onBack = navigator::back) }
    entry<AppearanceRoute> { AppearanceScreen(core = core, onBack = navigator::back) }
    entry<AboutRoute> { AboutScreen(onBack = navigator::back) }
    entry<DeveloperRoute> { DeveloperScreen(phone = phone, onBack = navigator::back) }
    entry<VoiceRoute> { VoiceSettingsScreen(core = core, onBack = navigator::back) }
    features.session?.let { session -> entry<SessionRoute> { route -> context.session(route) } }
    features.newSession?.let { newSession -> entry<NewSessionRoute> { context.newSession() } }
    workspaceEntries(context)
}
