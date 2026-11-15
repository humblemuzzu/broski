package com.muzammil.broski.feature.workspace.terminal

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.terminal.Key
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The keys a phone keyboard lacks, floating above it: esc, a sticky ctrl, tab, arrows that repeat, `|`, `~`, `/` and paste. */
@Composable
fun AccessoryRow(keyboard: TerminalKeyboard, onPaste: () -> Unit, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = MaterialTheme.shapes.extraLarge,
        shadowElevation = 3.dp,
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
    ) {
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            TextKey("esc", R.string.terminal_key_escape) { keyboard.key(Key.Escape) }
            TextKey("ctrl", R.string.terminal_key_ctrl, checked = keyboard.ctrl) { keyboard.ctrl = !keyboard.ctrl }
            IconKey(R.drawable.ic_keyboard_tab, R.string.terminal_key_tab) { keyboard.key(Key.Tab) }
            IconKey(R.drawable.ic_keyboard_arrow_left, R.string.terminal_key_left, repeats = true) { keyboard.key(Key.ArrowLeft) }
            IconKey(R.drawable.ic_keyboard_arrow_up, R.string.terminal_key_up, repeats = true) { keyboard.key(Key.ArrowUp) }
            IconKey(R.drawable.ic_keyboard_arrow_down, R.string.terminal_key_down, repeats = true) { keyboard.key(Key.ArrowDown) }
            IconKey(R.drawable.ic_keyboard_arrow_right, R.string.terminal_key_right, repeats = true) { keyboard.key(Key.ArrowRight) }
            TextKey("|", R.string.terminal_key_pipe) { keyboard.commit("|") }
            TextKey("~", R.string.terminal_key_tilde) { keyboard.commit("~") }
            TextKey("/", R.string.terminal_key_slash) { keyboard.commit("/") }
            IconKey(R.drawable.ic_content_paste, R.string.terminal_paste, onPress = onPaste)
        }
    }
}

@Composable
private fun TextKey(label: String, @StringRes description: Int, checked: Boolean = false, onPress: () -> Unit) {
    AccessoryKey(stringResource(description), checked, repeats = false, onPress) {
        Text(label, style = MaterialTheme.typography.labelLarge.mono())
    }
}

@Composable
private fun IconKey(@DrawableRes icon: Int, @StringRes description: Int, repeats: Boolean = false, onPress: () -> Unit) {
    AccessoryKey(stringResource(description), checked = false, repeats, onPress) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp))
    }
}

/** A key that fires on press, as keyboard keys do; held, a repeating one fires again and again. */
@Composable
private fun AccessoryKey(
    description: String,
    checked: Boolean,
    repeats: Boolean,
    onPress: () -> Unit,
    content: @Composable () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val press = rememberUpdatedState(onPress)
    val colors = MaterialTheme.colorScheme
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = if (checked) colors.primary else colors.surfaceContainerLowest,
        contentColor = if (checked) colors.onPrimary else colors.onSurface,
        modifier = Modifier
            .heightIn(min = 44.dp)
            .widthIn(min = 48.dp)
            .semantics {
                contentDescription = description
                role = Role.Button
                if (checked) selected = true
                onClick {
                    press.value()
                    true
                }
            }
            .pointerInput(repeats) {
                coroutineScope {
                    awaitEachGesture {
                        awaitFirstDown()
                        haptics.perform(Haptic.KeyPress)
                        press.value()
                        val repeater = if (repeats) {
                            launch {
                                delay(REPEAT_DELAY_MS)
                                while (true) {
                                    press.value()
                                    delay(REPEAT_EVERY_MS)
                                }
                            }
                        } else {
                            null
                        }
                        waitForUpOrCancellation()
                        repeater?.cancel()
                    }
                }
            },
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) { content() }
    }
}

private const val REPEAT_DELAY_MS = 400L
private const val REPEAT_EVERY_MS = 50L
