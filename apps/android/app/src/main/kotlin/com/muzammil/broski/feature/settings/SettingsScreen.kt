package com.muzammil.broski.feature.settings

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.BuildConfig
import com.muzammil.broski.R
import com.muzammil.broski.core.AppCore
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.perform

private data class NotificationRow(val kind: NotificationKind, @StringRes val title: Int, @StringRes val body: Int)

private val NotificationRows = listOf(
    NotificationRow(NotificationKind.NeedsYou, R.string.settings_notify_needs_you, R.string.settings_notify_needs_you_body),
    NotificationRow(NotificationKind.Done, R.string.settings_notify_done, R.string.settings_notify_done_body),
    NotificationRow(NotificationKind.Failures, R.string.settings_notify_failures, R.string.settings_notify_failures_body),
)

private data class AppearanceOption(val appearance: Appearance, @StringRes val label: Int, @DrawableRes val icon: Int)

private val AppearanceOptions = listOf(
    AppearanceOption(Appearance.System, R.string.settings_appearance_system, R.drawable.ic_brightness_auto),
    AppearanceOption(Appearance.Light, R.string.settings_appearance_light, R.drawable.ic_light_mode),
    AppearanceOption(Appearance.Dark, R.string.settings_appearance_dark, R.drawable.ic_dark_mode),
)

/** Notification kinds, appearance, versions and the privacy line; nothing deeper. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun SettingsScreen(core: AppCore, phone: PhoneSession) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings, phone.machines) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeFlexibleTopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                scrollBehavior = scrollBehavior,
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
        ) {
            notifications(state.settings.notifications, viewModel::setNotification)
            item(key = "appearance") {
                SectionHeader(stringResource(R.string.settings_appearance))
                AppearancePicker(state.settings.appearance, viewModel::setAppearance)
            }
            about(state)
        }
    }
}

private fun LazyListScope.notifications(enabled: Set<NotificationKind>, onChange: (NotificationKind, Boolean) -> Unit) {
    item(key = "notifications") { SectionHeader(stringResource(R.string.settings_notifications)) }
    NotificationRows.forEachIndexed { index, row ->
        item(key = "notify:${row.kind}") {
            val checked = row.kind in enabled
            SegmentedListItem(
                checked = checked,
                onCheckedChange = { onChange(row.kind, it) },
                shapes = ListItemDefaults.segmentedShapes(index, NotificationRows.size),
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                supportingContent = { Text(stringResource(row.body)) },
                trailingContent = { Switch(checked = checked, onCheckedChange = null) },
                colors = groupedListItemColors(),
            ) { Text(stringResource(row.title)) }
        }
    }
}

/**
 * A connected button group; at large font scales three labels no longer fit a row, so the options
 * stack as full-width toggle buttons.
 */
@Composable
private fun AppearancePicker(selected: Appearance, onSelect: (Appearance) -> Unit) {
    val haptics = LocalHapticFeedback.current
    val stacked = LocalDensity.current.fontScale > STACKED_FONT_SCALE
    val option: @Composable (Int, AppearanceOption, Modifier) -> Unit = { index, option, modifier ->
        ToggleButton(
            checked = selected == option.appearance,
            onCheckedChange = {
                if (selected != option.appearance) haptics.perform(Haptic.PickerStep)
                onSelect(option.appearance)
            },
            modifier = modifier.semantics { role = Role.RadioButton },
            shapes = when {
                stacked -> ToggleButtonDefaults.shapesFor(ToggleButtonDefaults.size)
                index == 0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                index == AppearanceOptions.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
            },
        ) {
            Icon(
                painterResource(option.icon),
                contentDescription = null,
                modifier = Modifier.padding(end = ToggleButtonDefaults.IconSpacing),
            )
            Text(stringResource(option.label), maxLines = 1)
        }
    }
    if (stacked) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AppearanceOptions.forEachIndexed { index, it -> option(index, it, Modifier.fillMaxWidth()) }
        }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween),
        ) {
            AppearanceOptions.forEachIndexed { index, it -> option(index, it, Modifier.weight(1f)) }
        }
    }
}

private const val STACKED_FONT_SCALE = 1.3f

private fun LazyListScope.about(state: SettingsUiState) {
    item(key = "about") { SectionHeader(stringResource(R.string.settings_about)) }
    val versions = buildList {
        add(R.string.settings_version_app to BuildConfig.VERSION_NAME)
        add(R.string.settings_version_core to BuildConfig.CORE_VERSION)
    }
    val count = versions.size + state.machines.size
    versions.forEachIndexed { index, (label, version) ->
        item(key = "version:$label") {
            AboutRow(stringResource(label), version, index, count)
        }
    }
    state.machines.forEachIndexed { index, machine ->
        item(key = "bridge:${machine.id}") {
            AboutRow(
                title = machine.name,
                value = machine.bridgeVersion?.let { stringResource(R.string.machines_bridge_version, it) }
                    ?: stringResource(R.string.settings_bridge_unknown),
                index = versions.size + index,
                count = count,
            )
        }
    }
    item(key = "privacy") {
        Row(
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                painterResource(R.drawable.ic_lock),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                stringResource(R.string.settings_privacy),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun AboutRow(title: String, value: String, index: Int, count: Int) {
    SegmentedListItem(
        shapes = ListItemDefaults.segmentedShapes(index, count),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        supportingContent = { Text(value) },
        colors = groupedListItemColors(),
    ) { Text(title) }
}
