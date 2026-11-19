package com.muzammil.broski.design.code

import uniffi.broski_core.DiffFile
import uniffi.broski_core.DiffLine
import uniffi.broski_core.DiffLineKind
import uniffi.broski_core.DiffSegment
import uniffi.broski_core.TokenKind

enum class DiffRowKind { Hunk, Context, Added, Removed, NoNewline }

/**
 * One drawn line of a unified diff: its sign and text, the words the core marked as changed
 * ([segments], empty when none), and the old and new line numbers as the gutter shows them.
 */
data class DiffRow(val kind: DiffRowKind, val text: String, val segments: List<DiffSegment>, val gutter: String)

/** A file's hunks as unified lines: an `@@` line per hunk, then its lines with their `+`, `-` or space. */
fun diffRows(file: DiffFile): List<DiffRow> {
    val width = numberWidth(file)
    return file.hunks.flatMap { hunk ->
        val header = "@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@" + (hunk.header?.let { " $it" } ?: "")
        listOf(DiffRow(DiffRowKind.Hunk, header, emptyList(), "")) + hunk.lines.map { line ->
            val kind = line.rowKind
            val sign = line.sign
            val gutter = if (kind == DiffRowKind.NoNewline) "" else "${number(line.oldLine, width)} ${number(line.newLine, width)}"
            val segments = if (line.segments.isEmpty()) emptyList() else listOf(DiffSegment(sign, false, TokenKind.PLAIN)) + line.segments
            DiffRow(kind, sign + line.text, segments, gutter)
        }
    }
}

/** The digits the widest line number of [file] takes, so every gutter lines up. */
fun numberWidth(file: DiffFile): Int =
    file.hunks.maxOfOrNull { maxOf(it.oldStart + it.oldLines, it.newStart + it.newLines).toString().length } ?: 1

fun number(line: Long?, width: Int): String = (line?.toString() ?: "").padStart(width)

val DiffLine.rowKind: DiffRowKind
    get() = when (kind) {
        DiffLineKind.CONTEXT -> DiffRowKind.Context
        DiffLineKind.ADDED -> DiffRowKind.Added
        DiffLineKind.REMOVED -> DiffRowKind.Removed
        DiffLineKind.NO_NEWLINE -> DiffRowKind.NoNewline
    }

private val DiffLine.sign: String
    get() = when (kind) {
        DiffLineKind.ADDED -> "+"
        DiffLineKind.REMOVED -> "-"
        DiffLineKind.CONTEXT -> " "
        DiffLineKind.NO_NEWLINE -> "\\ "
    }
