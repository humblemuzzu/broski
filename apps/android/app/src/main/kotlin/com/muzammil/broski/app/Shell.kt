package com.muzammil.broski.app

import androidx.compose.material3.Icon
import androidx.compose.material3.LargeFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.feature.inbox.InboxScreen
import com.muzammil.broski.feature.machines.MachinesScreen
import com.muzammil.broski.feature.pairing.PairScreen
import com.muzammil.broski.feature.settings.SettingsScreen
import com.muzammil.broski.feature.workspace.workspaceEntries

/**
 * The app once a Mac is paired: the navigation bar (a wide rail on large windows) around one
 * [NavDisplay], which gives every screen predictive back.
 */
@Composable
fun Shell(core: AppCore, phone: PhoneSession, features: Features) {
    val navigator = rememberNavigator()
    val context = remember(phone, navigator) { FeatureContext(phone, navigator::open, navigator::back) }
    var newSessionOpen by rememberSaveable { mutableStateOf(false) }
    val tabs = TopLevel.entries.filter { it != TopLevel.Workspace || features.workspace != null }

    NavigationSuiteScaffold(
        navigationItems = {
            tabs.forEach { top ->
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
            if (features.newSession != null && navigator.tab == TopLevel.Inbox) {
                LargeFloatingActionButton(onClick = { newSessionOpen = true }) {
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
            entryProvider = entryProvider {
                shellEntries(core, context, features, navigator) { newSessionOpen = true }
            },
        )
    }
    if (newSessionOpen) {
        features.newSession?.invoke(context) { newSessionOpen = false }
    }
}

private fun EntryProviderScope<Route>.shellEntries(
    core: AppCore,
    context: FeatureContext,
    features: Features,
    navigator: Navigator,
    openNewSession: () -> Unit,
) {
    val phone = context.phone
    entry<InboxRoute> {
        InboxScreen(
            phone = phone,
            onOpenMachines = { navigator.open(MachinesRoute) },
            onOpenSession = features.session?.let { { route -> navigator.open(route) } },
            onNewSession = features.newSession?.let { openNewSession },
        )
    }
    entry<MachinesRoute> {
        MachinesScreen(phone = phone, onBack = navigator::back, onPairAnother = { navigator.open(PairRoute) })
    }
    entry<PairRoute> { PairScreen(phone = phone, onBack = navigator::back, onPaired = navigator::back) }
    entry<SettingsRoute> { SettingsScreen(core = core, phone = phone) }
    features.session?.let { session -> entry<SessionRoute> { route -> context.session(route) } }
    features.workspace?.let { workspace ->
        entry<WorkspaceRoute> { context.workspace() }
        workspaceEntries(context)
    }
}
