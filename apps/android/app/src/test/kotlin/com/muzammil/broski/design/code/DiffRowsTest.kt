package com.muzammil.broski.design.code

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.FileChange
import uniffi.broski_contract.FileChangeKind
import uniffi.broski_contract.GitChange
import uniffi.broski_contract.GitDiffFile
import uniffi.broski_contract.GitDiffHunk
import uniffi.broski_contract.GitDiffLine
import uniffi.broski_contract.GitDiffLineKind
import uniffi.broski_core.DiffSegment
import uniffi.broski_core.TokenKind
import uniffi.broski_core.fileChangeDiff
import uniffi.broski_core.gitDiffFile

/** Diff lines as the app draws them, from the real core's parse of a git answer and of a tool's file change. */
class DiffRowsTest {
    @Test
    fun aGitHunkBecomesUnifiedLinesWithBothLineNumbersAndTheMissingNewlineSaid() {
        val file = GitDiffFile(
            path = "README.md",
            previousPath = null,
            change = GitChange.MODIFIED,
            binary = false,
            hunks = listOf(
                GitDiffHunk(
                    oldStart = 9, oldLines = 2, newStart = 9, newLines = 2, header = "## Usage",
                    lines = listOf(
                        GitDiffLine(GitDiffLineKind.CONTEXT, "# Demo", 9, 9, null),
                        GitDiffLine(GitDiffLineKind.REMOVED, "old", 10, null, true),
                        GitDiffLine(GitDiffLineKind.ADDED, "new", null, 10, null),
                    ),
                ),
            ),
        )
        val rows = diffRows(gitDiffFile(file)).map { Triple(it.kind, it.text, it.gutter) }
        assertEquals(
            listOf(
                Triple(DiffRowKind.Hunk, "@@ -9,2 +9,2 @@ ## Usage", ""),
                Triple(DiffRowKind.Context, " # Demo", " 9  9"),
                Triple(DiffRowKind.Removed, "-old", "10   "),
                Triple(DiffRowKind.NoNewline, "\\ No newline at end of file", ""),
                Triple(DiffRowKind.Added, "+new", "   10"),
            ),
            rows,
        )
    }

    @Test
    fun anEditedWordIsMarkedBehindItsSignAndTheSegmentsSpellTheWholeLine() {
        val change = FileChange("src/count.ts", FileChangeKind.MODIFIED, null, "@@ -1 +1 @@\n-let count = 1;\n+let count = 2;\n", 1, 1)
        val rows = diffRows(fileChangeDiff(change)).drop(1)
        rows.forEach { row -> assertEquals(row.text, row.segments.joinToString("") { it.text }) }
        assertEquals(DiffSegment("-", false, TokenKind.PLAIN), rows[0].segments.first())
        assertTrue(rows[0].segments.any { it.text.trim() == "let" && it.kind == TokenKind.KEYWORD && !it.emphasized })
        assertEquals(DiffSegment("1", true, TokenKind.NUMBER), rows[0].segments.single { it.emphasized })
        assertEquals(DiffSegment("2", true, TokenKind.NUMBER), rows[1].segments.single { it.emphasized })
    }
}
