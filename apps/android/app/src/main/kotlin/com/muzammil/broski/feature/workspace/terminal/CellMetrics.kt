package com.muzammil.broski.feature.workspace.terminal

import kotlin.math.ceil
import kotlin.math.floor

/**
 * One terminal cell in pixels: as wide as the font's advance (exact, so a run of cells drawn as one
 * string lands on the grid) and as tall as its line. [baseline] is from the cell's top.
 */
data class CellMetrics(val width: Float, val height: Float, val baseline: Float) {
    /** The cell size a program reads (`term.resize`'s pixels): whole pixels, at least one. */
    val reportedWidth: Int get() = ceil(width).toInt().coerceIn(1, MAX_DIMENSION)
    val reportedHeight: Int get() = ceil(height).toInt().coerceIn(1, MAX_DIMENSION)

    /** How many whole cells fit in a view of this size, within the contract's 1–500. */
    fun grid(widthPx: Int, heightPx: Int): GridSize = GridSize(
        cols = floor(widthPx / width).toInt().coerceIn(1, MAX_DIMENSION),
        rows = floor(heightPx / height).toInt().coerceIn(1, MAX_DIMENSION),
    )

    /** The cell under a point of the view, kept inside the grid. */
    fun cellAt(x: Float, y: Float, grid: GridSize): Pair<Int, Int> = Pair(
        floor(x / width).toInt().coerceIn(0, grid.cols - 1),
        floor(y / height).toInt().coerceIn(0, grid.rows - 1),
    )

    companion object {
        /** The contract's `MAX_TERMINAL_DIMENSION`. */
        const val MAX_DIMENSION = 500

        /** Metrics from a font's advance and its ascent and descent (descent positive, ascent negative, as Android reports them). */
        fun of(advance: Float, ascent: Float, descent: Float, leading: Float = 0f): CellMetrics {
            val height = ceil(descent - ascent + leading)
            return CellMetrics(width = advance, height = height, baseline = ceil(-ascent + leading / 2))
        }
    }
}

data class GridSize(val cols: Int, val rows: Int)
