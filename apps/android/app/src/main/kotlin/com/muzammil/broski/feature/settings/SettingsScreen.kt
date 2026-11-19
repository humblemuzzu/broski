package com.muzammil.broski.feature.settings

import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
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
import com.muzammil.broski.core.settings.KeepScreenAwake
import com.muzammil.broski.core.settings.NotificationKind
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.SectionHeader
import com.muzammil.broski.design.groupedListItemColors
import com.muzammil.broski.design.perform
import uniffi.broski_core.coreVersion

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

private data class KeepAwakeOption(val mode: KeepScreenAwake, @StringRes val label: Int)

private val KeepAwakeOptions = listOf(
    KeepAwakeOption(KeepScreenAwake.DictationOnly, R.string.settings_keep_awake_dictation),
    KeepAwakeOption(KeepScreenAwake.WhileWorking, R.string.settings_keep_awake_working),
    KeepAwakeOption(KeepScreenAwake.Always, R.string.settings_keep_awake_always),
)

/** Notification kinds, voice, appearance, versions and the privacy line. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun SettingsScreen(core: AppCore, phone: PhoneSession, onOpenVoice: () -> Unit) {
    val viewModel = viewModel { SettingsViewModel(core.settingsStore, core.settings, phone.machines) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val core = remember { coreVersion() }
    val coreDescription = stringResource(R.string.settings_core_version, core.library, core.protocol.major, core.protocol.minor)
    var gallery by rememberSaveable { mutableStateOf(false) }
    var reading by rememberSaveable { mutableStateOf(false) }
    if (gallery) FormattingGallery(onDismiss = { gallery = false })
    if (reading) ReadingSheet(state.settings.reading, viewModel::setReading, onDismiss = { reading = false })

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
            if (Build.VERSION.SDK_INT >= 36) {
                item(key = "live-promotion") { LiveUpdatePromotionRow() }
            }
            item(key = "voice") { VoiceRow(onOpenVoice) }
            item(key = "appearance") {
                SectionHeader(stringResource(R.string.settings_appearance))
                AppearancePicker(state.settings.appearance, viewModel::setAppearance)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    DynamicColorRow(state.settings.dynamicColor, viewModel::setDynamicColor)
                }
            }
            keepAwake(state.settings.keepScreenAwake, viewModel::setKeepScreenAwake)
            item(key = "formatting") { FormattingRow(onReading = { reading = true }, onGallery = { gallery = true }) }
            about(state, coreDescription)
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun DynamicColorRow(enabled: Boolean, onChange: (Boolean) -> Unit) {
    SegmentedListItem(
        checked = enabled,
        onCheckedChange = onChange,
        shapes = ListItemDefaults.segmentedShapes(0, 1),
        modifier = Modifier.padding(horizontal = 16.dp).padding(top = 12.dp),
        supportingContent = { Text(stringResource(R.string.settings_dynamic_color_body)) },
        trailingContent = { Switch(checked = enabled, onCheckedChange = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.settings_dynamic_color)) }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun LiveUpdatePromotionRow() {
    if (Build.VERSION.SDK_INT < 36) return
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(NotificationManager::class.java) }
    if (manager?.canPostPromotedNotifications() == true) return
    SegmentedListItem(
        onClick = {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            context.startActivity(intent)
        },
        shapes = ListItemDefaults.segmentedShapes(0, 1),
        modifier = Modifier.padding(horizontal = 16.dp).padding(top = 8.dp),
        leadingContent = { Icon(painterResource(R.drawable.ic_notification), contentDescription = null) },
        supportingContent = { Text(stringResource(R.string.settings_live_promotion_body)) },
        trailingContent = { Icon(painterResource(R.drawable.ic_open_in_new), contentDescription = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.settings_live_promotion)) }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun FormattingRow(onReading: () -> Unit, onGallery: () -> Unit) {
    SectionHeader(stringResource(R.string.format_reading))
    SegmentedListItem(
        onClick = onReading,
        shapes = ListItemDefaults.segmentedShapes(0, 2),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        leadingContent = { Icon(painterResource(R.drawable.ic_edit_note), contentDescription = null) },
        supportingContent = { Text(stringResource(R.string.format_reading_body)) },
        trailingContent = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.format_reading)) }
    SegmentedListItem(
        onClick = onGallery,
        shapes = ListItemDefaults.segmentedShapes(1, 2),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        leadingContent = { Icon(painterResource(R.drawable.ic_wrap_text), contentDescription = null) },
        supportingContent = { Text(stringResource(R.string.format_gallery_body)) },
        trailingContent = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.format_gallery)) }
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

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun VoiceRow(onOpen: () -> Unit) {
    SectionHeader(stringResource(R.string.voice_title))
    SegmentedListItem(
        onClick = onOpen,
        shapes = ListItemDefaults.segmentedShapes(0, 1),
        modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
        leadingContent = { Icon(painterResource(R.drawable.ic_mic), contentDescription = null) },
        supportingContent = { Text(stringResource(R.string.voice_settings_row_body)) },
        trailingContent = { Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) },
        colors = groupedListItemColors(),
    ) { Text(stringResource(R.string.voice_settings_row)) }
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

private fun LazyListScope.keepAwake(selected: KeepScreenAwake, onSelect: (KeepScreenAwake) -> Unit) {
    item(key = "keep_awake") { SectionHeader(stringResource(R.string.settings_keep_awake)) }
    KeepAwakeOptions.forEachIndexed { index, option ->
        item(key = "keep_awake:${option.mode}") {
            val checked = selected == option.mode
            SegmentedListItem(
                selected = checked,
                onClick = { onSelect(option.mode) },
                shapes = ListItemDefaults.segmentedShapes(index, KeepAwakeOptions.size),
                modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap),
                trailingContent = if (checked) {
                    { Icon(painterResource(R.drawable.ic_check), contentDescription = null) }
                } else {
                    null
                },
                colors = groupedListItemColors(),
            ) { Text(stringResource(option.label)) }
        }
    }
    item(key = "keep_awake_body") {
        Text(
            stringResource(R.string.settings_keep_awake_body),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp),
        )
    }
}

private const val STACKED_FONT_SCALE = 1.3f

private fun LazyListScope.about(state: SettingsUiState, coreDescription: String) {
    item(key = "about") { SectionHeader(stringResource(R.string.settings_about)) }
    val versions = buildList {
        add(R.string.settings_version_app to BuildConfig.VERSION_NAME)
        add(R.string.settings_version_core to coreDescription)
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
