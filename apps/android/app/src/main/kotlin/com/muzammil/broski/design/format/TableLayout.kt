package com.muzammil.broski.design.format

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.MonoFamily
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.FormatTable
import uniffi.broski_core.TableShape

data class TableLayout(val widths: List<Dp>, val scrolls: Boolean, val sticky: Boolean) {
    companion object {
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

        fun columnWidths(table: FormatTable, measure: TableMeasure): Pair<List<Dp>, List<Dp>> {
            val padding = FormatTokens.cellHorizontal * 2
            val natural = mutableListOf<Dp>()
            val minimum = mutableListOf<Dp>()
            table.columns.indices.forEach { column ->
                val headerCell = measure.cell(table.header[column].spans, header = true)
                var line = headerCell.first
                var word = headerCell.second
                table.rows.take(MEASURED_ROWS).forEach { row ->
                    val measured = measure.cell(row[column].spans, header = false)
                    line = maxOf(line, measured.first)
                    word = maxOf(word, measured.second)
                }
                natural += line + padding
                minimum += (word + padding).coerceIn(FormatTokens.tableMinColumn, FormatTokens.tableMaxMinColumn)
            }
            return natural to minimum
        }

        private fun share(width: Dp, base: List<Dp>, weights: List<Dp>): List<Dp> {
            val extra = (width - base.sum()).coerceAtLeast(0.dp)
            val total = weights.sum()
            return base.zip(weights) { column, weight ->
                column + if (total > 0.dp) extra * (weight / total) else extra / base.size
            }
        }
    }
}

class TableMeasure(private val measurer: TextMeasurer, private val cell: TextStyle, private val header: TextStyle, private val density: Density) {
    fun cell(spans: List<FormatSpan>, header: Boolean): Pair<Dp, Dp> {
        val base = if (header) this.header else cell
        val styled = buildMeasurable(spans, base, header)
        if (styled.isEmpty()) return 0.dp to 0.dp
        val raw = styled.text
        var widestLine = 0
        var lineStart = 0
        for (i in 0..raw.length) {
            if (i == raw.length || raw[i] == '\n') {
                if (i > lineStart) {
                    val w = measurer.measure(styled.subSequence(lineStart, i), base, softWrap = false, maxLines = 1).size.width
                    if (w > widestLine) widestLine = w
                }
                lineStart = i + 1
            }
        }
        var widestWord = 0
        var wordStart = 0
        for (i in 0..raw.length) {
            if (i == raw.length || raw[i] == ' ' || raw[i] == '\n' || raw[i] == '\t') {
                if (i > wordStart) {
                    val w = measurer.measure(styled.subSequence(wordStart, i), base, softWrap = false, maxLines = 1).size.width
                    if (w > widestWord) widestWord = w
                }
                wordStart = i + 1
            }
        }
        return with(density) { widestLine.toDp() to widestWord.toDp() }
    }

    private fun buildMeasurable(spans: List<FormatSpan>, base: TextStyle, isHeader: Boolean): AnnotatedString = buildAnnotatedString {
        val codeSize = inlineCodeSize(base.fontSize)
        for (span in spans) {
            val chip = span.code || span.math
            val style = SpanStyle(
                fontFamily = if (chip || span.html) MonoFamily else null,
                fontSize = if (chip) codeSize else base.fontSize,
                fontWeight = if (span.strong || isHeader) FontWeight.SemiBold else if (span.code) FontWeight.Medium else null,
            )
            withStyle(style) {
                append(if (chip) "\u202F${span.text}\u202F" else span.text)
            }
        }
    }
}

fun plain(spans: List<FormatSpan>): String = spans.joinToString("") { it.text }

private fun List<Dp>.sum(): Dp = fold(0.dp) { total, width -> total + width }
