package com.muzammil.broski.terminal

/** libbroski_terminal's functions (src/main/c); [VtTerminal] is the only caller. */
internal object Native {
    init {
        System.loadLibrary("broski_terminal")
    }

    @JvmStatic external fun create(cols: Int, rows: Int): Long

    @JvmStatic external fun free(handle: Long)

    @JvmStatic external fun write(handle: Long, data: ByteArray): ByteArray

    @JvmStatic external fun reset(handle: Long)

    @JvmStatic external fun resize(handle: Long, cols: Int, rows: Int, cellWidth: Int, cellHeight: Int): Boolean

    @JvmStatic external fun setColors(handle: Long, foreground: Int, background: Int, cursor: Int)

    @JvmStatic external fun update(handle: Long, frame: Frame, cells: IntArray, dirty: IntArray, meta: IntArray): Boolean

    @JvmStatic external fun encodeKey(handle: Long, key: Int, mods: Int, text: String?, unshifted: Int): ByteArray

    @JvmStatic external fun paste(handle: Long, text: ByteArray): ByteArray

    @JvmStatic external fun pasteIsSafe(handle: Long, text: ByteArray): Boolean

    @JvmStatic external fun scroll(handle: Long, rows: Int)

    @JvmStatic external fun scrollToBottom(handle: Long)

    @JvmStatic external fun select(handle: Long, startCol: Int, startRow: Int, endCol: Int, endRow: Int): Boolean

    @JvmStatic external fun selectWord(handle: Long, col: Int, row: Int): Boolean

    @JvmStatic external fun clearSelection(handle: Long)

    @JvmStatic external fun text(handle: Long, selected: Boolean): String?
}
