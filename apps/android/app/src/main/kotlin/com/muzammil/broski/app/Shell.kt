package com.muzammil.broski.app

import androidx.compose.material3.Icon
import androidx.compose.material3.LargeFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.rememberNavigationSuiteScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.feature.inbox.InboxScreen
import com.muzammil.broski.feature.machines.MachinesScreen
import com.muzammil.broski.feature.pairing.PairScreen
import com.muzammil.broski.feature.settings.SettingsScreen
import com.muzammil.broski.feature.settings.VoiceSettingsScreen
import com.muzammil.broski.feature.usage.UsageScreen
import com.muzammil.broski.feature.workspace.workspaceEntries

/**
 * The app once a Mac is paired: the navigation bar (a wide rail on large windows) around one
 * [NavDisplay], which gives every screen predictive back.
 */
@Composable
fun Shell(core: AppCore, phone: PhoneSession, features: Features, openRequests: OpenRequests) {
    val navigator = rememberNavigator()
    OpenRequested(openRequests, phone, features, navigator)
    val machines by phone.machines.collectAsStateWithLifecycle()
    val onlineCount = machines.count { it.health.isOnline }
    LaunchedEffect(phone, onlineCount) {
        if (onlineCount > 0) core.usage.refresh(phone)
    }
    val context = remember(phone, navigator) { FeatureContext(phone, navigator::open, navigator::back) }
    // The chat's composer is its bottom edge, a new session's too: no navigation bar under it.
    val suite = rememberNavigationSuiteScaffoldState()
    val top = navigator.entries.lastOrNull()
    val inChat = top is SessionRoute || top == NewSessionRoute
    LaunchedEffect(inChat) { if (inChat) suite.hide() else suite.show() }

    NavigationSuiteScaffold(
        state = suite,
        navigationItems = {
            TopLevel.entries.forEach { top ->
                val selected = navigator.tab == top
                NavigationSuiteItem(
                    selected = selected,
                    onClick = { navigator.select(top) },
                    icon = { Icon(painterResource(if (selected) top.selectedIcon else top.icon), contentDescription = null) },
                    label = { Text(stringResource(top.label)) },
                )
            }
        },
        primaryActionContent = {
            if (features.newSession != null && navigator.entries.lastOrNull() == InboxRoute) {
                LargeFloatingActionButton(onClick = { navigator.open(NewSessionRoute) }) {
                    Icon(painterResource(R.drawable.ic_add), contentDescription = stringResource(R.string.new_session))
                }
            }
        },
    ) {
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
}

/**
 * A session a notification asked for: the chat once it exists and the machine is still paired,
 * else the inbox it is listed in.
 */
@Composable
private fun OpenRequested(openRequests: OpenRequests, phone: PhoneSession, features: Features, navigator: Navigator) {
    val requested by openRequests.next.collectAsStateWithLifecycle()
    LaunchedEffect(requested) {
        val route = requested ?: return@LaunchedEffect
        when (route) {
            is SessionRoute -> {
                if (navigator.tab != TopLevel.Inbox) navigator.select(TopLevel.Inbox)
                if (features.session != null && phone.machine(route.machineId) != null) navigator.open(route)
            }
            UsageRoute -> {
                if (navigator.tab != TopLevel.Settings) navigator.select(TopLevel.Settings)
                navigator.open(UsageRoute)
            }
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
            onOpenMachines = { navigator.open(MachinesRoute) },
            onOpenSession = features.session?.let { { route -> navigator.open(route) } },
            onNewSession = features.newSession?.let { { navigator.open(NewSessionRoute) } },
        )
    }
    entry<MachinesRoute> {
        MachinesScreen(phone = phone, onBack = navigator::back, onPairAnother = { navigator.open(PairRoute) })
    }
    entry<PairRoute> { PairScreen(phone = phone, onBack = navigator::back, onPaired = navigator::back) }
    entry<SettingsRoute> {
        SettingsScreen(
            core = core,
            phone = phone,
            onOpenVoice = { navigator.open(VoiceRoute) },
            onOpenUsage = { navigator.open(UsageRoute) },
        )
    }
    entry<VoiceRoute> { VoiceSettingsScreen(core = core, onBack = navigator::back) }
    entry<UsageRoute> { UsageScreen(core = core, phone = phone, onBack = navigator::back) }
    features.session?.let { session -> entry<SessionRoute> { route -> context.session(route) } }
    features.newSession?.let { newSession -> entry<NewSessionRoute> { context.newSession() } }
    workspaceEntries(context)
}
