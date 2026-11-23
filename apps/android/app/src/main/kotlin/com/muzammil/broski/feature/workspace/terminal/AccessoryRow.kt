package com.muzammil.broski.feature.workspace.terminal

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.mono
import com.muzammil.broski.design.perform
import com.muzammil.broski.terminal.Key
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val KeyHeight = 36.dp
private val KeyMinWidth = 44.dp
private val KeyGap = 4.dp
private val FadeWidth = 24.dp
private val KeyStyle = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold).mono()

/**
 * The keys a phone keyboard lacks, in one row under the terminal: esc, a sticky ctrl and tab, which
 * stay where they are, then arrows that repeat while held, `|`, `~`, `/` and paste, which scroll under
 * a fading edge when the row is too narrow. Every key goes through the emulator's encoder.
 */
@Composable
fun AccessoryRow(keyboard: TerminalKeyboard, enabled: Boolean, onPaste: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(start = 12.dp, top = 4.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(KeyGap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextKey("esc", R.string.terminal_key_escape, enabled) { keyboard.key(Key.Escape) }
        CtrlKey(keyboard.ctrl, enabled, keyboard::tapCtrl)
        TextKey("tab", R.string.terminal_key_tab, enabled) { keyboard.key(Key.Tab) }
        FadingScroll(Modifier.weight(1f)) {
            IconKey(R.drawable.ic_keyboard_arrow_left, R.string.terminal_key_left, enabled, repeats = true) { keyboard.key(Key.ArrowLeft) }
            IconKey(R.drawable.ic_keyboard_arrow_up, R.string.terminal_key_up, enabled, repeats = true) { keyboard.key(Key.ArrowUp) }
            IconKey(R.drawable.ic_keyboard_arrow_down, R.string.terminal_key_down, enabled, repeats = true) { keyboard.key(Key.ArrowDown) }
            IconKey(R.drawable.ic_keyboard_arrow_right, R.string.terminal_key_right, enabled, repeats = true) { keyboard.key(Key.ArrowRight) }
            TextKey("|", R.string.terminal_key_pipe, enabled) { keyboard.commit("|") }
            TextKey("~", R.string.terminal_key_tilde, enabled) { keyboard.commit("~") }
            TextKey("/", R.string.terminal_key_slash, enabled) { keyboard.commit("/") }
            IconKey(R.drawable.ic_content_paste, R.string.terminal_paste, enabled, onPress = onPaste)
        }
    }
}

/** A row that scrolls sideways under a fading trailing edge while there is more of it past that edge. */
@Composable
private fun FadingScroll(modifier: Modifier, content: @Composable () -> Unit) {
    val scroll = rememberScrollState()
    Row(
        modifier = modifier
            .graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
            .drawWithContent {
                drawContent()
                if (scroll.canScrollForward) {
                    val fade = FadeWidth.toPx()
                    drawRect(
                        Brush.horizontalGradient(0f to Color.Black, 1f to Color.Transparent, startX = size.width - fade, endX = size.width),
                        topLeft = Offset(size.width - fade, 0f),
                        blendMode = BlendMode.DstIn,
                    )
                }
            }
            .horizontalScroll(scroll)
            .padding(end = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(KeyGap),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

@Composable
private fun TextKey(label: String, @StringRes description: Int, enabled: Boolean, onPress: () -> Unit) {
    KeyCap(stringResource(description), enabled, active = false, repeats = false, onPress = onPress) {
        Text(label, style = KeyStyle, maxLines = 1, softWrap = false)
    }
}

@Composable
private fun IconKey(@DrawableRes icon: Int, @StringRes description: Int, enabled: Boolean, repeats: Boolean = false, onPress: () -> Unit) {
    KeyCap(stringResource(description), enabled, active = false, repeats = repeats, onPress = onPress) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp))
    }
}

/** Ctrl: lit while it is on for the next key or kept on, and it says which, with how to keep it on. */
@Composable
private fun CtrlKey(state: CtrlState, enabled: Boolean, onTap: () -> Unit) {
    val description = stringResource(
        when (state) {
            CtrlState.Off -> R.string.terminal_key_ctrl_off
            CtrlState.Armed -> R.string.terminal_key_ctrl_armed
            CtrlState.Locked -> R.string.terminal_key_ctrl_locked
        },
    )
    KeyCap(
        description = stringResource(R.string.terminal_key_ctrl),
        enabled = enabled,
        active = state != CtrlState.Off,
        repeats = false,
        state = description,
        hint = stringResource(R.string.terminal_key_ctrl_hint),
        onPress = onTap,
    ) { Text("ctrl", style = KeyStyle, maxLines = 1, softWrap = false) }
}

/**
 * A key cap: a glass capsule at least 44 by 36 that answers the touch, firing on press as keyboard
 * keys do; held, a repeating one fires again and again.
 */
@Composable
private fun KeyCap(
    description: String,
    enabled: Boolean,
    active: Boolean,
    repeats: Boolean,
    state: String? = null,
    hint: String? = null,
    onPress: () -> Unit,
    content: @Composable () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val press = rememberUpdatedState(onPress)
    var pressed by remember { mutableStateOf(false) }
    val height = with(LocalDensity.current) { 36.sp.toDp() }.coerceAtLeast(KeyHeight)
    val shape = CircleShape
    val body = Modifier
        .heightIn(min = height)
        .widthIn(min = KeyMinWidth)
        .alpha(if (!enabled) 0.4f else if (pressed) 0.7f else 1f)
        .semantics {
            contentDescription = description
            role = Role.Button
            state?.let { stateDescription = it }
            if (!enabled) disabled()
            onClick(label = hint) {
                press.value()
                true
            }
        }
        .keyPresses(enabled, repeats, onDown = { pressed = true; haptics.perform(Haptic.KeyPress); press.value() }, onRepeat = { press.value() }, onUp = { pressed = false })
    val label = if (active) Color.White else LocalContentColor.current
    if (active) {
        Box(body.clip(shape).background(BroskiTheme.semantic.highlight, shape).padding(horizontal = KeyGap), contentAlignment = Alignment.Center) {
            CompositionLocalProvider(LocalContentColor provides label) { content() }
        }
    } else {
        GlassSurface(shape, body) { Box(Modifier.padding(horizontal = KeyGap).heightIn(min = height).widthIn(min = KeyMinWidth - KeyGap * 2), contentAlignment = Alignment.Center) { content() } }
    }
}

private fun Modifier.keyPresses(enabled: Boolean, repeats: Boolean, onDown: () -> Unit, onRepeat: () -> Unit, onUp: () -> Unit): Modifier =
    pointerInput(enabled, repeats) {
        if (!enabled) return@pointerInput
        coroutineScope {
            awaitEachGesture {
                awaitFirstDown()
                onDown()
                val repeater = if (repeats) {
                    launch {
                        delay(REPEAT_DELAY_MS)
                        while (true) {
                            onRepeat()
                            delay(REPEAT_EVERY_MS)
                        }
                    }
                } else {
                    null
                }
                waitForUpOrCancellation()
                repeater?.cancel()
                onUp()
            }
        }
    }

private const val REPEAT_DELAY_MS = 400L
private const val REPEAT_EVERY_MS = 70L
