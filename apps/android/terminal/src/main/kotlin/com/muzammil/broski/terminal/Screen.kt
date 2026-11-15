package com.muzammil.broski.terminal

data class Cursor(
    val visible: Boolean,
    val col: Int,
    val row: Int,
    val style: CursorStyle,
    val blinking: Boolean,
    /** ARGB, when the program set one. */
    val color: Int?,
)

/** Rows of scrollback above the viewport: `offset` is the viewport's first row within `total`. */
data class Scrollback(val total: Int, val offset: Int, val visible: Int) {
    val atBottom: Boolean get() = offset + visible >= total
}

/**
 * One frame of the terminal, immutable, for the UI. A row whose [rowVersions] entry is unchanged
 * since the previous screen is drawn exactly as before.
 */
class Screen internal constructor(
    val cols: Int,
    val rows: Int,
    private val cells: IntArray,
    private val clusters: Map<Int, String>,
    val rowVersions: LongArray,
    val cursor: Cursor,
    /** ARGB of the default foreground and background. */
    val foreground: Int,
    val background: Int,
    val scrollback: Scrollback,
) {
    private fun index(col: Int, row: Int) = (row * cols + col) * Frame.CELL_INTS

    /** The cell's text: empty for a blank cell or a wide character's spacer. */
    fun text(col: Int, row: Int): String {
        val codepoint = cells[index(col, row)]
        return when {
            codepoint == -1 -> clusters[row * cols + col].orEmpty()
            codepoint == 0 -> ""
            else -> String(Character.toChars(codepoint))
        }
    }

    /** ARGB, meaningful when [attrs] has [Cell.HAS_FOREGROUND]. */
    fun foreground(col: Int, row: Int): Int = cells[index(col, row) + 1]

    /** ARGB, meaningful when [attrs] has [Cell.HAS_BACKGROUND]. */
    fun background(col: Int, row: Int): Int = cells[index(col, row) + 2]

    fun attrs(col: Int, row: Int): Int = cells[index(col, row) + 3]

    /** A row's text as drawn, trailing blanks dropped; wide characters once. */
    fun line(row: Int): String = buildString {
        for (col in 0 until cols) append(text(col, row).ifEmpty { if (Cell.width(attrs(col, row)) == Cell.Width.SpacerTail) "" else " " })
    }.trimEnd()

    companion object {
        val Empty = Screen(
            cols = 0,
            rows = 0,
            cells = IntArray(0),
            clusters = emptyMap(),
            rowVersions = LongArray(0),
            cursor = Cursor(visible = false, col = 0, row = 0, style = CursorStyle.Block, blinking = false, color = null),
            foreground = 0,
            background = 0,
            scrollback = Scrollback(0, 0, 0),
        )
    }
}
