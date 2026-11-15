package com.muzammil.broski.feature.workspace.terminal

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.muzammil.broski.terminal.Key
import com.muzammil.broski.terminal.Mods

/**
 * What the soft keyboard, a hardware keyboard and the accessory row type, on its way to the
 * terminal: Ctrl from the accessory row holds for the next key; the IME's composing text is shown
 * at the cursor and sent only once committed.
 */
@Stable
class TerminalKeyboard(private val terminal: TerminalViewModel) {
    var ctrl by mutableStateOf(false)
    var composing by mutableStateOf("")

    fun commit(text: String) {
        composing = ""
        val key = text.singleOrNull()?.let(Key::of)
        if (ctrl && key != null) {
            val lower = text.lowercase()
            press(KeyInput.Press(key, Mods.NONE, lower, lower[0].code))
        } else if (text.isNotEmpty()) {
            terminal.type(text)
        }
    }

    fun press(input: KeyInput) {
        when (input) {
            is KeyInput.Press -> terminal.key(input.key, input.mods or (if (ctrl) Mods.CTRL else Mods.NONE), input.text, input.unshifted)
            is KeyInput.Type -> terminal.type(input.text)
        }
        ctrl = false
    }

    fun key(key: Key) = press(KeyInput.Press(key, Mods.NONE, null, 0))

    fun backspace(count: Int) = repeat(count) { key(Key.Backspace) }
}
