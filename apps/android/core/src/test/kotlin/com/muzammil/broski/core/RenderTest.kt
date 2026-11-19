package com.muzammil.broski.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BooleanField
import uniffi.broski_contract.BooleanValue
import uniffi.broski_contract.ConditionOperator
import uniffi.broski_contract.FieldCondition
import uniffi.broski_contract.FormFieldSpec
import uniffi.broski_contract.FormScalar
import uniffi.broski_contract.FormValue
import uniffi.broski_contract.JsonMember
import uniffi.broski_contract.JsonValue
import uniffi.broski_contract.TextValue
import uniffi.broski_core.CodeSpan
import uniffi.broski_core.DiffLineKind
import uniffi.broski_core.DiffSegment
import uniffi.broski_core.FoldTool
import uniffi.broski_core.FormatCode
import uniffi.broski_core.FormatContent
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.TokenKind
import uniffi.broski_core.ToolFacts
import uniffi.broski_core.ToolKind
import uniffi.broski_core.foldCounts
import uniffi.broski_core.formFieldDefault
import uniffi.broski_core.formFieldShown
import uniffi.broski_core.formatMarkdown
import uniffi.broski_core.formatSamples
import uniffi.broski_core.highlight
import uniffi.broski_core.languageForPath
import uniffi.broski_core.parseUnifiedDiff
import uniffi.broski_core.sideBySide
import uniffi.broski_core.toolLook

/** The rendering exports from Kotlin: what a code view and a diff view draw. */
class RenderTest {
    @Test
    fun markdownComesBackAsKeyedBlocksAndTheGalleryHasItsSamples() {
        val blocks = formatMarkdown("Run `x`.\n\n```kotlin\nval x = 1", true)
        assertEquals(listOf("p-0", "code-10"), blocks.map { it.key })
        val span = { text: String, code: Boolean -> FormatSpan(text, false, false, false, code, false, false, null) }
        assertEquals(FormatContent.Paragraph(listOf(span("Run ", false), span("x", true), span(".", false))), blocks[0].content)
        assertEquals(FormatContent.Code(FormatCode("kotlin", null, "val x = 1", false, false)), blocks[1].content)
        assertTrue(formatSamples().isNotEmpty())
    }

    @Test
    fun codeAndDiffsComeBackReadyToDraw() {
        val first = highlight("val x = 1", "kotlin").first().spans.first()
        assertEquals("val", first.text.trim())
        assertEquals(TokenKind.KEYWORD, first.kind)
        assertEquals("Swift", languageForPath("Sources/App.swift"))

        val hunk = parseUnifiedDiff("@@ -1 +1 @@\n-val a = 1\n+val a = 2\n").files.single().hunks.single()
        assertEquals(listOf(DiffLineKind.REMOVED, DiffLineKind.ADDED), hunk.lines.map { it.kind })
        assertTrue(DiffSegment("2", true, TokenKind.PLAIN) in hunk.lines[1].segments)
        assertEquals(1, sideBySide(hunk).size)
    }

    @Test
    fun aToolCallComesBackAsItsRowAndTheFoldCountsWhatItDid() {
        val input = JsonValue.Object(listOf(JsonMember("command", JsonValue.String("npm test"))))
        val look = toolLook(ToolFacts("Bash", null, input, false, emptyList()))
        assertEquals(ToolKind.COMMAND, look.kind)
        assertEquals("npm test", look.label)
        assertEquals("Ran command", look.verb)
        assertEquals("npm test", look.command)
        assertEquals(listOf("Ran 1 command"), foldCounts(listOf(FoldTool("1", look.kind, look.paths))).map { it.phrase })
    }

    @Test
    fun aFormFieldIsShownByTheAnswersAndStartsFromItsDefault() {
        val field = FormFieldSpec.Boolean(
            BooleanField("deploy", null, null, false, false, listOf(FieldCondition("env", ConditionOperator.EQ, FormScalar.Text(TextValue("prod")))), true),
        )
        assertTrue(formFieldShown(field, mapOf("env" to FormValue.Text(TextValue("prod")))))
        assertTrue(!formFieldShown(field, mapOf("env" to FormValue.Text(TextValue("dev")))))
        assertEquals(FormValue.Boolean(BooleanValue(true)), formFieldDefault(field))
    }
}
