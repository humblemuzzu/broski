package com.muzammil.broski.design.format

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Test
import uniffi.broski_core.FormatContent
import uniffi.broski_core.formatMarkdown

/** An answer's spans as the app styles them, from the real core's parse. */
class FormatSpansTest {
    private val text = "See [the spec](https://spec.commonmark.org), `src/a.ts:3`, `/api/v1/x` and https://example.com."

    private fun styled(opensFiles: Boolean) = formatSpans(
        (formatMarkdown(text, false).single().content as FormatContent.Paragraph).spans,
        SpanLook(14.sp, Color.Blue, Color.Green, Color.Gray, underlinesLinks = false, opensFiles = opensFiles),
    ) {}

    private fun linked(opensFiles: Boolean): List<String> {
        val built = styled(opensFiles)
        return built.getLinkAnnotations(0, built.length).map { built.text.substring(it.start, it.end) }
    }

    private fun chips(opensFiles: Boolean): List<String> {
        val built = styled(opensFiles)
        return built.getStringAnnotations("chip", 0, built.length).map { built.text.substring(it.start, it.end).trim('\u202F') }
    }

    @Test
    fun aTitledPageGetsItsGlobeAPathInCodeOpensItsFileAndARouteIsPlainCode() {
        val built = styled(opensFiles = true)
        assertEquals(1, built.getStringAnnotations("androidx.compose.foundation.text.inlineContent", 0, built.length).size)
        assertEquals(listOf("the spec", "src/a.ts:3", "https://example.com"), linked(opensFiles = true))
        assertEquals(listOf("/api/v1/x"), chips(opensFiles = true))
        assertEquals(LinkAnnotation.Clickable::class, built.getLinkAnnotations(0, built.length).first().item::class)
    }

    @Test
    fun whereTheTextBelongsToNoMachineAPathIsTheCodeItIs() {
        assertEquals(listOf("the spec", "https://example.com"), linked(opensFiles = false))
        assertEquals(listOf("src/a.ts:3", "/api/v1/x"), chips(opensFiles = false))
    }
}
