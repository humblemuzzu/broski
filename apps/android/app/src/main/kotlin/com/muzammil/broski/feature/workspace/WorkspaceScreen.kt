package com.muzammil.broski.feature.workspace

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.core.MachineState
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform

enum class WorkspaceTab(val label: Int, val icon: Int) {
    Files(R.string.workspace_tab_files, R.drawable.ic_folder),
    Git(R.string.workspace_tab_git, R.drawable.ic_account_tree),
    Terminal(R.string.workspace_tab_terminal, R.drawable.ic_terminal),
}

/** The Workspace tab: a machine (picked when there are several), then its files, git and terminals. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun WorkspaceScreen(context: FeatureContext) {
    val machines by context.phone.machines.collectAsStateWithLifecycle()
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    var tab by rememberSaveable { mutableStateOf(WorkspaceTab.Files) }
    val machine = machines.firstOrNull { it.id == picked } ?: machines.firstOrNull { it.health.isOnline } ?: machines.firstOrNull()
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val snackbar = remember { SnackbarHostState() }
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { LargeFlexibleTopAppBar(title = { Text(stringResource(R.string.nav_workspace)) }, scrollBehavior = scrollBehavior) },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
            if (machines.size > 1) MachinePicker(machines, machine?.id) { picked = it }
            TabButtons(tab) { tab = it }
            if (machine == null) {
                EmptyState(stringResource(R.string.workspace_no_machine_title), stringResource(R.string.workspace_no_machine_body))
            } else {
                MachineGate(context.phone, machine.id) { handle, state ->
                    WorkspaceTabContent(context, handle, state, tab, snackbar)
                }
            }
        }
    }
}

@Composable
private fun MachinePicker(machines: List<MachineState>, selected: String?, onPick: (String) -> Unit) {
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        machines.forEach { machine ->
            FilterChip(
                selected = machine.id == selected,
                onClick = {
                    haptics.perform(Haptic.PickerStep)
                    onPick(machine.id)
                },
                label = { Text(machine.name) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_computer), contentDescription = null, modifier = Modifier.size(18.dp)) },
            )
        }
    }
}

/** Files, Git and Terminal as one connected group of toggle buttons. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun TabButtons(selected: WorkspaceTab, onSelect: (WorkspaceTab) -> Unit) {
    val haptics = LocalHapticFeedback.current
    val tabs = WorkspaceTab.entries
    // At large font scales a third of a phone's width has room for the word alone.
    val icons = LocalDensity.current.fontScale < LARGE_FONT_SCALE
    val labelSize = ButtonDefaults.textStyleFor(ButtonDefaults.MinHeight).fontSize
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween),
    ) {
        tabs.forEachIndexed { index, tab ->
            ToggleButton(
                checked = tab == selected,
                onCheckedChange = {
                    if (tab != selected) haptics.perform(Haptic.PickerStep)
                    onSelect(tab)
                },
                shapes = when (index) {
                    0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                    tabs.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                    else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                },
                modifier = Modifier.weight(1f).semantics { role = Role.Tab },
            ) {
                if (icons) Icon(painterResource(tab.icon), contentDescription = null, modifier = Modifier.padding(end = 8.dp).size(18.dp))
                Text(
                    stringResource(tab.label),
                    maxLines = 1,
                    autoSize = TextAutoSize.StepBased(minFontSize = MIN_LABEL_SIZE, maxFontSize = labelSize),
                )
            }
        }
    }
}

private const val LARGE_FONT_SCALE = 1.3f
private val MIN_LABEL_SIZE = 10.sp
