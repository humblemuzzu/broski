package com.muzammil.broski.design.format

import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.FormatTable
import uniffi.broski_core.TableShape

/**
 * How a table's columns fit a width, the automatic layout of formatting-plan.md §5.6: natural
 * widths when they fit; else each column at least its longest word (56–200 dp) with the rest of the
 * width shared out and cells wrapping; else columns capped near 240 dp and the table scrolls
 * sideways, its first column held still when it is short. A key/value table always fits.
 */
data class TableLayout(val widths: List<Dp>, val scrolls: Boolean, val sticky: Boolean) {
    companion object {
        /** Rows measured for widths: past these, columns are as wide as their first rows need. */
        private const val MEASURED_ROWS = 200

        fun fit(table: FormatTable, width: Dp, measure: TableMeasure): TableLayout {
            val (natural, minimum) = columnWidths(table, measure)
            if (table.shape == TableShape.KEY_VALUE && natural.size == 2) {
                val key = minOf(natural[0], width * FormatTokens.KEY_COLUMN_SHARE)
                return TableLayout(listOf(key, maxOf(width - key, minimum[1])), scrolls = false, sticky = false)
            }
            if (natural.sum() <= width) return TableLayout(share(width, natural, natural), scrolls = false, sticky = false)
            if (minimum.sum() <= width) {
                val weights = natural.zip(minimum) { a, b -> a - b }
                return TableLayout(share(width, minimum, weights), scrolls = false, sticky = false)
            }
            val capped = natural.zip(minimum) { a, b -> maxOf(minOf(a, FormatTokens.tableScrollColumn), b) }
            val sticky = table.columns.firstOrNull()?.short == true && capped.size > 2 && capped[0] < width * 0.4f
            return TableLayout(capped, scrolls = true, sticky = sticky)
        }

        /** Each column's width on one line, and its narrowest without breaking a word (56–200 dp). */
        fun columnWidths(table: FormatTable, measure: TableMeasure): Pair<List<Dp>, List<Dp>> {
            val padding = FormatTokens.cellHorizontal * 2
            val natural = mutableListOf<Dp>()
            val minimum = mutableListOf<Dp>()
            table.columns.indices.forEach { column ->
                var line = measure.line(plain(table.header[column].spans), header = true)
                var word = measure.longestWord(plain(table.header[column].spans), header = true)
                table.rows.take(MEASURED_ROWS).forEach { row ->
                    val text = plain(row[column].spans)
                    line = maxOf(line, measure.line(text, header = false))
                    word = maxOf(word, measure.longestWord(text, header = false))
                }
                natural += line + padding
                minimum += (word + padding).coerceIn(FormatTokens.tableMinColumn, FormatTokens.tableMaxMinColumn)
            }
            return natural to minimum
        }

        /** [base] widened to fill [width], the extra shared by [weights]. */
        private fun share(width: Dp, base: List<Dp>, weights: List<Dp>): List<Dp> {
            val extra = (width - base.sum()).coerceAtLeast(0.dp)
            val total = weights.sum()
            return base.zip(weights) { column, weight ->
                column + if (total > 0.dp) extra * (weight / total) else extra / base.size
            }
        }
    }
}

/** Measures cell text in the table's fonts. */
class TableMeasure(private val measurer: TextMeasurer, private val cell: TextStyle, private val header: TextStyle, private val density: Density) {
    fun line(text: String, header: Boolean): Dp {
        val style = if (header) this.header else cell
        val widest = text.split('\n').maxOfOrNull { measurer.measure(it, style, softWrap = false, maxLines = 1).size.width } ?: 0
        return with(density) { widest.toDp() }
    }

    fun longestWord(text: String, header: Boolean): Dp {
        val word = text.split(' ', '\n', '\t').maxByOrNull { it.length } ?: return 0.dp
        return line(word, header)
    }
}

fun plain(spans: List<FormatSpan>): String = spans.joinToString("") { it.text }

private fun List<Dp>.sum(): Dp = fold(0.dp) { total, width -> total + width }
