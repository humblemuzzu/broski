package com.muzammil.broski.feature.workspace.terminal

import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusEventModifierNode
import androidx.compose.ui.focus.FocusState
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.platform.PlatformTextInputMethodRequest
import androidx.compose.ui.platform.PlatformTextInputModifierNode
import androidx.compose.ui.platform.establishTextInputSession
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Connects the IME to the terminal while it has focus. `showRequests` reopens the keyboard each
 * time it changes, as a tap on the terminal asks; put it after a focus target.
 */
fun Modifier.terminalInput(keyboard: TerminalKeyboard, showRequests: Int): Modifier =
    this then TerminalInputElement(keyboard, showRequests)

private data class TerminalInputElement(val keyboard: TerminalKeyboard, val showRequests: Int) :
    ModifierNodeElement<TerminalInputNode>() {
    override fun create() = TerminalInputNode(keyboard, showRequests)

    override fun update(node: TerminalInputNode) = node.update(keyboard, showRequests)

    override fun InspectorInfo.inspectableProperties() {
        name = "terminalInput"
    }
}

private class TerminalInputNode(var keyboard: TerminalKeyboard, private var showRequests: Int) :
    Modifier.Node(), PlatformTextInputModifierNode, FocusEventModifierNode {
    private var session: Job? = null
    private var focused = false

    fun update(keyboard: TerminalKeyboard, showRequests: Int) {
        this.keyboard = keyboard
        if (showRequests != this.showRequests && focused) restart()
        this.showRequests = showRequests
    }

    override fun onFocusEvent(focusState: FocusState) {
        if (focusState.isFocused == focused) return
        focused = focusState.isFocused
        if (focused) restart() else stop()
    }

    override fun onDetach() = stop()

    private fun restart() {
        session?.cancel()
        session = coroutineScope.launch {
            establishTextInputSession {
                startInputMethod(PlatformTextInputMethodRequest { info -> connection(view, info) })
            }
        }
    }

    private fun stop() {
        session?.cancel()
        session = null
    }

    /**
     * A plain text field with no suggestions, as a shell line is not prose. TYPE_NULL or a password
     * variation would also do, but keyboards then hide their language key, and composing scripts
     * (pinyin, kana) could not be typed at all.
     */
    private fun connection(view: View, info: EditorInfo): BaseInputConnection {
        info.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        info.imeOptions = EditorInfo.IME_ACTION_NONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_FLAG_NO_FULLSCREEN
        info.initialSelStart = 0
        info.initialSelEnd = 0
        return TerminalInputConnection(view) { keyboard }
    }
}

/**
 * The IME's side: committed text goes to the program, composing text is only shown, and deletes
 * remove from the composition first, then send Backspace. Nothing can be read back: the line
 * belongs to the program on the Mac.
 */
private class TerminalInputConnection(view: View, private val keyboard: () -> TerminalKeyboard) : BaseInputConnection(view, false) {
    override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
        keyboard().commit(text?.toString().orEmpty())
        return true
    }

    override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
        keyboard().composing = text?.toString().orEmpty()
        return true
    }

    override fun finishComposingText(): Boolean {
        val composing = keyboard().composing
        if (composing.isNotEmpty()) keyboard().commit(composing)
        return true
    }

    override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        val target = keyboard()
        val composing = target.composing
        if (composing.isNotEmpty()) {
            target.composing = composing.dropLast(beforeLength)
        } else {
            target.backspace(beforeLength)
        }
        return true
    }

    override fun sendKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) keyInput(event)?.let(keyboard()::press)
        return true
    }

    override fun performEditorAction(actionCode: Int): Boolean {
        keyboard().key(com.muzammil.broski.terminal.Key.Enter)
        return true
    }

    override fun getTextBeforeCursor(length: Int, flags: Int): CharSequence = ""

    override fun getTextAfterCursor(length: Int, flags: Int): CharSequence = ""

    override fun getSelectedText(flags: Int): CharSequence = ""

    override fun getCursorCapsMode(reqModes: Int): Int = 0
}
