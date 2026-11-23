package com.muzammil.broski.feature.screen

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import uniffi.broski_core.ScreenShortcut

@Composable
internal fun ScreenToolbar(
    state: ScreenUiState,
    onToggleMode: () -> Unit,
    onPasswordTap: () -> Unit,
    onTypeTap: () -> Unit,
    onRightClick: () -> Unit,
    onPaste: () -> Unit,
    onShortcut: (ScreenShortcut) -> Unit,
    onToggleModifier: (ModifierKey) -> Unit,
    onTapKey: (UInt) -> Unit,
    onScroll: (Byte, Byte) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 3.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.navigationBarsPadding().padding(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ActionChipsRow(
                state.pointerMode,
                onToggleMode,
                onPasswordTap,
                onTypeTap,
                onRightClick,
                onPaste,
                onShortcut,
            )
            KeyChipsRow(state.activeModifiers, onToggleModifier, onTapKey, onScroll)
        }
    }
}

@Composable
private fun ActionChipsRow(
    pointerMode: PointerMode,
    onToggleMode: () -> Unit,
    onPasswordTap: () -> Unit,
    onTypeTap: () -> Unit,
    onRightClick: () -> Unit,
    onPaste: () -> Unit,
    onShortcut: (ScreenShortcut) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val modeLabel = if (pointerMode == PointerMode.Trackpad) R.string.screen_mode_trackpad else R.string.screen_mode_touch
        FilterChip(
            selected = pointerMode == PointerMode.Trackpad,
            onClick = onToggleMode,
            label = { Text(stringResource(modeLabel)) },
        )
        AssistChip(
            onClick = onPasswordTap,
            leadingIcon = { Icon(painterResource(R.drawable.ic_lock), contentDescription = null) },
            label = { Text(stringResource(R.string.screen_action_password)) },
        )
        AssistChip(
            onClick = onTypeTap,
            leadingIcon = { Icon(painterResource(R.drawable.ic_edit), contentDescription = null) },
            label = { Text(stringResource(R.string.screen_action_type)) },
        )
        AssistChip(onClick = onRightClick, label = { Text(stringResource(R.string.screen_action_right_click)) })
        AssistChip(onClick = { onShortcut(ScreenShortcut.SpaceLeft) }, label = { Text(stringResource(R.string.screen_space_left)) })
        AssistChip(onClick = { onShortcut(ScreenShortcut.SpaceRight) }, label = { Text(stringResource(R.string.screen_space_right)) })
        AssistChip(onClick = { onShortcut(ScreenShortcut.MissionControl) }, label = { Text(stringResource(R.string.screen_mission_control)) })
        AssistChip(
            onClick = onPaste,
            leadingIcon = { Icon(painterResource(R.drawable.ic_content_paste), contentDescription = null) },
            label = { Text(stringResource(R.string.screen_action_paste)) },
        )
    }
}

@Composable
private fun KeyChipsRow(
    activeModifiers: Set<ModifierKey>,
    onToggleModifier: (ModifierKey) -> Unit,
    onTapKey: (UInt) -> Unit,
    onScroll: (Byte, Byte) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ModifierKey.entries.forEach { mod ->
            FilterChip(
                selected = mod in activeModifiers,
                onClick = { onToggleModifier(mod) },
                label = { Text(mod.glyph) },
            )
        }
        KeyChip("Esc") { onTapKey(0xff1bU) }
        KeyChip("Tab") { onTapKey(0xff09U) }
        KeyChip("⌫") { onTapKey(0xff08U) }
        KeyChip("⏎") { onTapKey(0xff0dU) }
        KeyChip("←") { onTapKey(0xff51U) }
        KeyChip("↑") { onTapKey(0xff52U) }
        KeyChip("↓") { onTapKey(0xff54U) }
        KeyChip("→") { onTapKey(0xff53U) }
        KeyChip("Scroll ↑") { onScroll(0, 3) }
        KeyChip("Scroll ↓") { onScroll(0, -3) }
    }
}

@Composable
private fun KeyChip(label: String, onClick: () -> Unit) {
    AssistChip(onClick = onClick, label = { Text(label) })
}
