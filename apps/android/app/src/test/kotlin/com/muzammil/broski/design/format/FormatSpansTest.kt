package com.muzammil.broski.design.format

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Test
import uniffi.broski_core.FormatContent
import uniffi.broski_core.formatMarkdown

class FormatSpansTest {
    private val text = "See [the spec](https://spec.commonmark.org), `src/a.ts:3`, `/api/v1/x` and https://example.com."

    private fun styled(opensFiles: Boolean) = formatSpans(
        (formatMarkdown(text, false).single().content as FormatContent.Paragraph).spans,
        SpanLook(14.sp, Color.Blue, Color.Green, Color.Gray, underlinesLinks = false, opensFiles = opensFiles, inlineCode = Color.LightGray),
    ) {}

    private fun linked(opensFiles: Boolean): List<String> {
        val built = styled(opensFiles)
        return built.getLinkAnnotations(0, built.length).map { built.text.substring(it.start, it.end) }
    }

    @Test
    fun inlineCodeAndPathsRenderBoxlessAndOnlyValidLinksOpen() {
        val built = styled(opensFiles = true)
        assertEquals(0, built.getStringAnnotations(CHIP, 0, built.length).size)
        assertEquals(listOf("the spec", "src/a.ts:3", "https://example.com"), linked(opensFiles = true))
        assertEquals(LinkAnnotation.Clickable::class, built.getLinkAnnotations(0, built.length).first().item::class)
    }

    @Test
    fun whereTheTextBelongsToNoMachineAPathIsPlainCode() {
        assertEquals(listOf("the spec", "https://example.com"), linked(opensFiles = false))
    }

    @Test
    fun longCodeTokensGetDisplayBreakHintsWhileShortOnesStayUntouched() {
        assertEquals("set_model", breakableCode("set_model"))
        assertEquals("route_race.rs:42", breakableCode("route_race.rs:42"))
        assertEquals(
            "packages/\u200Bbridge/\u200Bsrc/\u200Bprotocol.ts",
            breakableCode("packages/bridge/src/protocol.ts"),
        )
        assertEquals(
            "FormatContainers.\u200Bswift",
            breakableCode("FormatContainers.swift"),
        )
    }
}
