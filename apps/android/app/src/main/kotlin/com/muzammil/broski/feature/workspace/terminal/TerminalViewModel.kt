package com.muzammil.broski.feature.workspace.terminal

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.muzammil.broski.terminal.Key
import com.muzammil.broski.terminal.Screen
import com.muzammil.broski.terminal.VtTerminal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.broski_contract.ActionResult
import uniffi.broski_core.ClientException
import uniffi.broski_core.TerminalUpdate
import uniffi.broski_core.TerminalView

sealed interface TerminalState {
    data object Live : TerminalState

    data class Exited(val exitCode: Long?, val signal: String?) : TerminalState

    data class Failed(val message: String?) : TerminalState
}

/** What the screen asks of the terminal's size: cells, and each cell's pixels. */
data class TerminalSize(val cols: Int, val rows: Int, val cellWidth: Int, val cellHeight: Int)

/**
 * One terminal of a Mac on the phone: the bridge's bytes pumped into libghostty-vt, frames out of it
 * at most [FRAME_MS] apart, and keys, pastes and resizes back in the order they were made. The
 * emulator lives on one thread; the view lives exactly as long as its loop (mobile-packaging.md §1).
 */
@OptIn(ExperimentalCoroutinesApi::class, FlowPreview::class)
class TerminalViewModel(open: () -> TerminalView) : ViewModel() {
    private val engine = Dispatchers.Default.limitedParallelism(1)
    private val vt = VtTerminal(INITIAL_COLS, INITIAL_ROWS)
    private val input = Channel<ByteArray>(Channel.UNLIMITED)
    private val redraw = Channel<Unit>(Channel.CONFLATED)
    private val size = MutableStateFlow<TerminalSize?>(null)

    private val mutableScreen = MutableStateFlow(Screen.Empty)
    val screen: StateFlow<Screen> = mutableScreen.asStateFlow()
    private val mutableState = MutableStateFlow<TerminalState>(TerminalState.Live)
    val state: StateFlow<TerminalState> = mutableState.asStateFlow()
    private val view: TerminalView? = try {
        open()
    } catch (error: ClientException) {
        mutableState.value = TerminalState.Failed(error.message)
        null
    }

    init {
        view?.let { viewModelScope.launch(engine) { pump(it) } }
        viewModelScope.launch(engine) { draw() }
        view?.let { viewModelScope.launch { send(it) } }
        view?.let { attached ->
            viewModelScope.launch {
                size.filterNotNull().distinctUntilChanged().debounce(RESIZE_PAUSE_MS).collect { applySize(attached, it) }
            }
        }
    }

    /** New defaults change how every row looks, not only the rows the program touched: a whole new frame. */
    fun setColors(foreground: Int, background: Int, cursor: Int) = onEngine {
        vt.setColors(foreground, background, cursor)
        vt.update()
        mutableScreen.value = vt.screen()
    }

    fun resize(next: TerminalSize) {
        size.value = next
    }

    /** What the keyboard typed: text as UTF-8, a newline as the Enter key. */
    fun type(text: String) = onEngine {
        text.split('\n').forEachIndexed { index, part ->
            if (index > 0) emit(vt.encode(Key.Enter))
            if (part.isNotEmpty()) emit(part.toByteArray())
        }
    }

    fun key(key: Key, mods: Int, text: String? = null, unshifted: Int = 0) = onEngine {
        emit(vt.encode(key, mods, text, unshifted))
    }

    fun paste(text: String) = onEngine { emit(vt.paste(text)) }

    suspend fun isPasteSafe(text: String): Boolean = withContext(engine) { vt.isPasteSafe(text) }

    fun scroll(rows: Int) = onEngine {
        vt.scroll(rows)
        redraw.trySend(Unit)
    }

    fun select(startCol: Int, startRow: Int, endCol: Int, endRow: Int) = onEngine {
        vt.select(startCol, startRow, endCol, endRow)
        redraw.trySend(Unit)
    }

    fun selectWord(col: Int, row: Int) = onEngine {
        vt.selectWord(col, row)
        redraw.trySend(Unit)
    }

    /** The selection's text, which ends the selection. */
    suspend fun takeSelection(): String? = withContext(engine) {
        vt.selectedText().also {
            vt.clearSelection()
            redraw.trySend(Unit)
        }
    }

    fun scrollToBottom() = onEngine {
        vt.scrollToBottom()
        redraw.trySend(Unit)
    }

    fun clearSelection() = onEngine {
        vt.clearSelection()
        redraw.trySend(Unit)
    }

    /** The screen and its scrollback as text, as the emulator holds it. */
    suspend fun text(): String = withContext(engine) { vt.text() }

    private fun onEngine(block: suspend () -> Unit) {
        viewModelScope.launch(engine) { block() }
    }

    /** Typing goes to the program and brings the view back to the bottom, as on a desktop terminal. */
    private fun emit(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        vt.scrollToBottom()
        vt.clearSelection()
        input.trySend(bytes)
        redraw.trySend(Unit)
    }

    private suspend fun pump(view: TerminalView) {
        try {
            while (true) {
                when (val update = view.nextUpdate() ?: break) {
                    is TerminalUpdate.Output -> {
                        if (update.reset) vt.reset()
                        val answer = vt.write(update.data)
                        // Replayed output had its queries answered when live; echoing them again would confuse the shell.
                        if (!update.reset && answer.isNotEmpty()) input.trySend(answer)
                        redraw.trySend(Unit)
                    }
                    is TerminalUpdate.Exited -> mutableState.value = TerminalState.Exited(update.exitCode, update.signal)
                    is TerminalUpdate.Failed -> mutableState.value = TerminalState.Failed(update.message)
                }
            }
        } finally {
            view.detach()
            view.close()
        }
    }

    private suspend fun draw() {
        for (signal in redraw) {
            if (vt.update()) mutableScreen.value = vt.screen()
            delay(FRAME_MS)
        }
    }

    /** Sends what was typed in order, everything waiting joined into one request of at most the contract's 64 KiB. */
    private suspend fun send(view: TerminalView) {
        for (first in input) {
            var batch = first
            while (batch.size < MAX_INPUT_BYTES) batch += input.tryReceive().getOrNull() ?: break
            var offset = 0
            while (offset < batch.size) {
                val end = minOf(batch.size, offset + MAX_INPUT_BYTES)
                deliver(view, batch.copyOfRange(offset, end))
                offset = end
            }
        }
    }

    private suspend fun deliver(view: TerminalView, bytes: ByteArray) {
        try {
            val result = view.input(bytes)
            if (result is ActionResult.Rejected) Log.i(TAG, "input refused: ${result.v1.rejection.message}")
        } catch (error: ClientException) {
            Log.i(TAG, "input not delivered", error)
        }
    }

    private suspend fun applySize(view: TerminalView, next: TerminalSize) {
        withContext(engine) {
            vt.resize(next.cols, next.rows, next.cellWidth, next.cellHeight)
            redraw.trySend(Unit)
        }
        try {
            view.resize(next.cols.toLong(), next.rows.toLong(), next.cellWidth.toLong(), next.cellHeight.toLong())
        } catch (error: ClientException) {
            Log.i(TAG, "resize not delivered", error)
        }
    }

    /** The cancelled pump detaches the view; the engine runs one task at a time, so the emulator closes after it. */
    override fun onCleared() {
        CoroutineScope(engine).launch { vt.close() }
    }

    private companion object {
        const val TAG = "Terminal"
        const val INITIAL_COLS = 80
        const val INITIAL_ROWS = 24
        const val FRAME_MS = 16L
        const val RESIZE_PAUSE_MS = 150L

        /** The contract's `MAX_TERMINAL_INPUT_BYTES`. */
        const val MAX_INPUT_BYTES = 65_536
    }
}
