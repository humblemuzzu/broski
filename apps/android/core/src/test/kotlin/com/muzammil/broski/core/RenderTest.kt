package com.muzammil.broski.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_core.BlockContent
import uniffi.broski_core.CodeSpan
import uniffi.broski_core.DiffLineKind
import uniffi.broski_core.DiffSegment
import uniffi.broski_core.TokenKind
import uniffi.broski_core.highlight
import uniffi.broski_core.languageForPath
import uniffi.broski_core.markdownBlocks
import uniffi.broski_core.parseUnifiedDiff
import uniffi.broski_core.sideBySide

/** The rendering exports from Kotlin: what a chat bubble, a code block and a diff view draw. */
class RenderTest {
    @Test
    fun markdownCodeAndDiffsComeBackReadyToDraw() {
        val blocks = markdownBlocks("Run **this**:\n\n```kotlin\nval x = 1\n```")
        assertEquals(listOf("p-0", "code-15"), blocks.map { it.key })
        val runs = (blocks[0].content as BlockContent.Paragraph).runs
        assertEquals(listOf("Run ", "this", ":"), runs.map { it.text })
        assertTrue(runs[1].strong)
        val code = blocks[1].content as BlockContent.Code
        assertEquals(CodeSpan("val", TokenKind.KEYWORD), highlight(code.text, code.language).first().spans.first())
        assertEquals("Swift", languageForPath("Sources/App.swift"))

        val hunk = parseUnifiedDiff("@@ -1 +1 @@\n-val a = 1\n+val a = 2\n").files.single().hunks.single()
        assertEquals(listOf(DiffLineKind.REMOVED, DiffLineKind.ADDED), hunk.lines.map { it.kind })
        assertTrue(DiffSegment("2", true) in hunk.lines[1].segments)
        assertEquals(1, sideBySide(hunk).size)
    }
}
