package com.muzammil.broski.feature.workspace.terminal

import android.view.KeyEvent
import com.muzammil.broski.terminal.Key
import com.muzammil.broski.terminal.Mods

sealed interface KeyInput {
    /** For the emulator's encoder: the key, its modifiers, what it types with Shift alone, and unshifted. */
    data class Press(val key: Key, val mods: Int, val text: String?, val unshifted: Int) : KeyInput

    /** A character no US key types (`é` on another layout): sent as the text itself. */
    data class Type(val text: String) : KeyInput
}

private val named = mapOf(
    KeyEvent.KEYCODE_ENTER to Key.Enter,
    KeyEvent.KEYCODE_NUMPAD_ENTER to Key.Enter,
    KeyEvent.KEYCODE_DEL to Key.Backspace,
    KeyEvent.KEYCODE_FORWARD_DEL to Key.Delete,
    KeyEvent.KEYCODE_TAB to Key.Tab,
    KeyEvent.KEYCODE_ESCAPE to Key.Escape,
    KeyEvent.KEYCODE_DPAD_UP to Key.ArrowUp,
    KeyEvent.KEYCODE_DPAD_DOWN to Key.ArrowDown,
    KeyEvent.KEYCODE_DPAD_LEFT to Key.ArrowLeft,
    KeyEvent.KEYCODE_DPAD_RIGHT to Key.ArrowRight,
    KeyEvent.KEYCODE_MOVE_HOME to Key.Home,
    KeyEvent.KEYCODE_MOVE_END to Key.End,
    KeyEvent.KEYCODE_PAGE_UP to Key.PageUp,
    KeyEvent.KEYCODE_PAGE_DOWN to Key.PageDown,
    KeyEvent.KEYCODE_INSERT to Key.Insert,
    KeyEvent.KEYCODE_SPACE to Key.Space,
    KeyEvent.KEYCODE_F1 to Key.F1, KeyEvent.KEYCODE_F2 to Key.F2, KeyEvent.KEYCODE_F3 to Key.F3,
    KeyEvent.KEYCODE_F4 to Key.F4, KeyEvent.KEYCODE_F5 to Key.F5, KeyEvent.KEYCODE_F6 to Key.F6,
    KeyEvent.KEYCODE_F7 to Key.F7, KeyEvent.KEYCODE_F8 to Key.F8, KeyEvent.KEYCODE_F9 to Key.F9,
    KeyEvent.KEYCODE_F10 to Key.F10, KeyEvent.KEYCODE_F11 to Key.F11, KeyEvent.KEYCODE_F12 to Key.F12,
)

/** `GhosttyMods` from an Android key event's meta state. */
fun mods(metaState: Int): Int {
    var mods = Mods.NONE
    if (metaState and KeyEvent.META_SHIFT_ON != 0) mods = mods or Mods.SHIFT
    if (metaState and KeyEvent.META_CTRL_ON != 0) mods = mods or Mods.CTRL
    if (metaState and KeyEvent.META_ALT_ON != 0) mods = mods or Mods.ALT
    if (metaState and KeyEvent.META_META_ON != 0) mods = mods or Mods.SUPER
    return mods
}

/**
 * What a hardware or IME key event sends, or null for a key the terminal leaves alone (volume,
 * back, a bare modifier). `typed` is what the key types with Shift alone, `unshifted` with no
 * modifier; each is 0 for a key that types nothing.
 */
fun keyInput(keyCode: Int, metaState: Int, typed: Int, unshifted: Int): KeyInput? {
    val mods = mods(metaState)
    named[keyCode]?.let { key ->
        val space = key == Key.Space
        return KeyInput.Press(key, mods, if (space) " " else null, if (space) ' '.code else 0)
    }
    if (typed <= 0) return null
    val text = String(Character.toChars(typed))
    val key = (if (unshifted > 0 && unshifted <= Char.MAX_VALUE.code) Key.of(unshifted.toChar()) else null) ?: Key.of(text[0])
    return if (key != null) KeyInput.Press(key, mods, text, unshifted) else KeyInput.Type(text)
}

fun keyInput(event: KeyEvent): KeyInput? {
    val typingMeta = event.metaState and (KeyEvent.META_CTRL_MASK or KeyEvent.META_ALT_MASK or KeyEvent.META_META_MASK).inv()
    return keyInput(event.keyCode, event.metaState, event.getUnicodeChar(typingMeta), event.getUnicodeChar(0))
}
