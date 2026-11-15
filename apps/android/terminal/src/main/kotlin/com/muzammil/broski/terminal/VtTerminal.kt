package com.muzammil.broski.terminal

/**
 * A libghostty-vt terminal: it reads what a program writes and keeps the screen, scrollback, cursor
 * and modes, and encodes keys and pastes the way that program asked for them. It neither draws nor
 * talks to a PTY. Not thread-safe: call it from one thread at a time.
 */
class VtTerminal(cols: Int, rows: Int) : AutoCloseable {
    private var handle = Native.create(cols, rows).also { check(it != 0L) { "no ${cols}x$rows terminal" } }
    private val frame = Frame(cols, rows)

    val cols: Int get() = frame.cols
    val rows: Int get() = frame.rows

    /** Returns the terminal's answers to the program's queries, which belong on the program's input. */
    fun write(data: ByteArray): ByteArray = Native.write(live(), data)

    fun reset() = Native.reset(live())

    /** The cell size in pixels is what image protocols and size reports read. */
    fun resize(cols: Int, rows: Int, cellWidth: Int, cellHeight: Int) {
        require(Native.resize(live(), cols, rows, cellWidth, cellHeight)) { "no ${cols}x$rows terminal" }
        frame.resize(cols, rows)
    }

    /** ARGB defaults; a program's own colours win over them. */
    fun setColors(foreground: Int, background: Int, cursor: Int) = Native.setColors(live(), foreground, background, cursor)

    /** Takes what changed into the frame; false when there is nothing new to draw. */
    fun update(): Boolean {
        check(Native.update(live(), frame, frame.cells, frame.dirty, frame.meta)) { "the render state could not be read" }
        return frame.endUpdate()
    }

    fun screen(): Screen = frame.snapshot()

    /**
     * `text` is what the key types with Shift alone applied, never a control character; `unshifted`
     * the codepoint it types with no modifier, or 0.
     */
    fun encode(key: Key, mods: Int = Mods.NONE, text: String? = null, unshifted: Int = 0): ByteArray =
        Native.encodeKey(live(), key.code, mods, text, unshifted)

    fun paste(text: String): ByteArray = Native.paste(live(), text.toByteArray())

    /** False when pasting `text` could run commands as it lands. */
    fun isPasteSafe(text: String): Boolean = Native.pasteIsSafe(live(), text.toByteArray())

    /** Negative is up. */
    fun scroll(rows: Int) = Native.scroll(live(), rows)

    fun scrollToBottom() = Native.scrollToBottom(live())

    fun select(startCol: Int, startRow: Int, endCol: Int, endRow: Int): Boolean =
        Native.select(live(), startCol, startRow, endCol, endRow)

    fun selectWord(col: Int, row: Int): Boolean = Native.selectWord(live(), col, row)

    fun clearSelection() = Native.clearSelection(live())

    fun selectedText(): String? = Native.text(live(), selected = true)

    /** The screen and its scrollback as plain text. */
    fun text(): String = Native.text(live(), selected = false).orEmpty()

    override fun close() {
        if (handle != 0L) Native.free(handle)
        handle = 0L
    }

    private fun live(): Long = handle.also { check(it != 0L) { "the terminal is closed" } }
}
