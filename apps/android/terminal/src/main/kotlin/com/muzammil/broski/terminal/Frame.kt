package com.muzammil.broski.terminal

/**
 * The terminal as last drawn, kept by [VtTerminal] and filled in place: each update rewrites only the
 * rows that changed. Engine-side and mutable; the UI reads [Screen]s taken from it.
 */
class Frame internal constructor(cols: Int, rows: Int) {
    var cols = cols
        private set
    var rows = rows
        private set
    internal var cells = IntArray(cols * rows * CELL_INTS)
        private set
    internal var dirty = IntArray(rows)
        private set
    internal val meta = IntArray(META_INTS)
    private var versions = LongArray(rows)
    private var clusters = HashMap<Int, String>()
    private var version = 0L

    internal fun resize(cols: Int, rows: Int) {
        if (cols == this.cols && rows == this.rows) return
        this.cols = cols
        this.rows = rows
        cells = IntArray(cols * rows * CELL_INTS)
        dirty = IntArray(rows)
        versions = LongArray(rows)
        clusters = HashMap()
    }

    /** Called by the shim, after an update, for each cell of several codepoints (an emoji sequence, a combining mark). */
    @Suppress("unused")
    @JvmName("cluster")
    internal fun cluster(index: Int, codepoints: IntArray) {
        clusters[index] = String(codepoints, 0, codepoints.size)
    }

    /** After an update: the rows it rewrote get a new version, and their old clusters go. True when anything changed. */
    internal fun endUpdate(): Boolean {
        version++
        var changed = false
        for (row in 0 until rows) {
            if (dirty[row] == 0) continue
            versions[row] = version
            changed = true
            val start = row * cols
            clusters.keys.removeAll { it in start until start + cols && cells[it * CELL_INTS] != -1 }
        }
        return changed || meta[0] != 0
    }

    fun snapshot(): Screen = Screen(
        cols = cols,
        rows = rows,
        cells = cells.copyOf(),
        clusters = HashMap(clusters),
        rowVersions = versions.copyOf(),
        cursor = Cursor(
            visible = meta[1] != 0,
            col = meta[2],
            row = meta[3],
            style = CursorStyle.entries.getOrElse(meta[4]) { CursorStyle.Block },
            blinking = meta[5] != 0,
            color = if (meta[9] != 0) meta[8] else null,
        ),
        foreground = meta[6],
        background = meta[7],
        scrollback = Scrollback(total = meta[10], offset = meta[11], visible = meta[12]),
    )

    internal companion object {
        const val CELL_INTS = 4
        const val META_INTS = 16
    }
}
