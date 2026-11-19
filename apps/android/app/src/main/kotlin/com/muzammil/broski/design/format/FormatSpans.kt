package com.muzammil.broski.design.format

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withAnnotation
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.core.net.toUri
import com.muzammil.broski.R
import com.muzammil.broski.design.MonoFamily
import uniffi.broski_core.FormatLink
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.LinkKind

/**
 * What a path in agent text opens: the file at its line on the machine the text belongs to. The chat
 * provides it; elsewhere a path is drawn as the code it is and opens nothing.
 */
@Stable
class FormatLinks(val openFile: (path: String, line: Int?) -> Unit)

val LocalFormatLinks = staticCompositionLocalOf<FormatLinks?> { null }

/** How spans are styled in one text. */
data class SpanLook(
    val codeSize: TextUnit,
    val link: Color,
    val path: Color,
    val muted: Color,
    val underlinesLinks: Boolean,
    val opensFiles: Boolean = true,
    /** The colour of bold runs, where it differs from the text around them. */
    val strong: Color = Color.Unspecified,
)

/** Spans as styled text with their links live: pages in Custom Tabs, addresses in mail, paths in Files. */
@Composable
fun rememberSpans(spans: List<FormatSpan>, look: SpanLook): AnnotatedString {
    val context = LocalContext.current
    val links = LocalFormatLinks.current
    val opens = look.copy(opensFiles = look.opensFiles && links != null)
    return remember(spans, opens, links) { formatSpans(spans, opens) { link -> openLink(context, links, link) } }
}

fun formatSpans(spans: List<FormatSpan>, look: SpanLook, open: (FormatLink) -> Unit): AnnotatedString = buildAnnotatedString {
    spans.forEach { span ->
        val link = span.link
        when {
            link != null && link.image -> withLink(annotation(link, look, open)) {
                withAnnotation(CHIP, "") {
                    withStyle(SpanStyle(fontWeight = FontWeight.Medium)) {
                        val detail = if (link.kind == LinkKind.Web) {
                            link.target.toUri().host ?: link.target
                        } else {
                            link.target.substringAfterLast('/')
                        }
                        val name = span.text.ifEmpty { detail }
                        val label = if (name == detail) name else "$name · $detail"
                        append("\u202F$label\u202F")
                    }
                }
            }
            link != null && link.kind == LinkKind.Footnote -> withStyle(
                SpanStyle(baselineShift = BaselineShift.Superscript, color = look.link, fontWeight = FontWeight.SemiBold),
            ) { append(span.text) }
            link != null && opens(link, look) -> {
                if (link.kind == LinkKind.Web && !link.bare && span.text != link.target) appendInlineContent(GLOBE, " ")
                withLink(annotation(link, look, open)) { appendStyled(span, look, chip = false) }
            }
            else -> appendStyled(span, look, chip = span.code || span.math)
        }
    }
}

private fun opens(link: FormatLink, look: SpanLook): Boolean = when (link.kind) {
    LinkKind.Web, LinkKind.Mail -> true
    is LinkKind.File -> look.opensFiles
    LinkKind.Footnote, LinkKind.Inert -> false
}

/** A chip (inline code or math with nothing to open) is marked for [chipFills] and padded with a thin space each side. */
private fun AnnotatedString.Builder.appendStyled(span: FormatSpan, look: SpanLook, chip: Boolean) {
    val mono = span.code || span.math || span.html
    val style = SpanStyle(
        fontWeight = if (span.strong) FontWeight.SemiBold else if (span.code) FontWeight.Medium else null,
        fontStyle = if (span.emphasis || span.math) FontStyle.Italic else null,
        textDecoration = if (span.strike) TextDecoration.LineThrough else null,
        color = if (span.strike || span.html) look.muted else if (span.strong) look.strong else Color.Unspecified,
        fontFamily = if (mono) MonoFamily else null,
        fontSize = if (span.code || span.math) look.codeSize else TextUnit.Unspecified,
    )
    if (chip) {
        withAnnotation(CHIP, "") { withStyle(style) { append("\u202F${span.text}\u202F") } }
    } else {
        withStyle(style) { append(span.text) }
    }
}

private fun annotation(link: FormatLink, look: SpanLook, open: (FormatLink) -> Unit): LinkAnnotation {
    val file = link.kind is LinkKind.File
    val decoration = if (look.underlinesLinks && !file) TextDecoration.Underline else null
    val styles = TextLinkStyles(SpanStyle(color = if (file) look.path else look.link, textDecoration = decoration))
    return LinkAnnotation.Clickable(link.target, styles) { open(link) }
}

/** Opens what a link names: a page in the in-app browser, an address in mail, a path in Files. */
fun openLink(context: Context, links: FormatLinks?, link: FormatLink) {
    when (val kind = link.kind) {
        LinkKind.Web -> CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, link.target.toUri())
        LinkKind.Mail -> try {
            context.startActivity(Intent(Intent.ACTION_SENDTO, link.target.toUri()))
        } catch (_: ActivityNotFoundException) {
        }
        is LinkKind.File -> links?.openFile?.invoke(link.target, kind.line?.toInt())
        LinkKind.Footnote, LinkKind.Inert -> Unit
    }
}

/** The inline code font size for a body size. */
fun inlineCodeSize(body: TextUnit): TextUnit = body * FormatTokens.INLINE_CODE_SCALE

/**
 * Formatted text as one [Text]: chips on rounded fills drawn behind the glyphs, and the globe a page
 * named by its title starts with.
 */
@Composable
fun SpanText(text: AnnotatedString, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified, codeSize: TextUnit) {
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val fill = formatCodeFill
    val radius = with(LocalDensity.current) { FormatTokens.inlineCodeRadius.toPx() }
    val codePx = with(LocalDensity.current) { codeSize.toPx() }
    Text(
        text,
        style = style,
        color = color,
        inlineContent = globeContent,
        onTextLayout = { layout = it },
        modifier = modifier.drawBehind { layout?.let { drawChips(it, text, fill, radius, codePx) } },
    )
}

private const val CHIP = "chip"
private const val GLOBE = "globe"

private val globeContent = mapOf(
    GLOBE to InlineTextContent(Placeholder(0.95.em, 0.85.em, PlaceholderVerticalAlign.TextCenter)) {
        Icon(painterResource(R.drawable.ic_language), contentDescription = null, tint = formatLink)
    },
)

/** A rounded fill behind each chip, line by line, its height the code font's rather than the line's. */
private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawChips(layout: TextLayoutResult, text: AnnotatedString, fill: Color, radius: Float, codePx: Float) {
    val end = layout.layoutInput.text.length
    for (chip in text.getStringAnnotations(CHIP, 0, text.length)) {
        val from = chip.start.coerceAtMost(end)
        val to = chip.end.coerceAtMost(end)
        if (from >= to) continue
        for (line in layout.getLineForOffset(from)..layout.getLineForOffset(to - 1)) {
            val lineStart = layout.getLineStart(line)
            val lineEnd = layout.getLineEnd(line, visibleEnd = true)
            val start = maxOf(from, lineStart)
            val stop = minOf(to, lineEnd)
            if (start >= stop) continue
            // The offset where a line breaks is placed at the start of the next line, so a chip that runs to the end of a
            // line, or from its start, takes the line's own edge there.
            val rtl = layout.getParagraphDirection(start) == androidx.compose.ui.text.style.ResolvedTextDirection.Rtl
            val a = if (start == lineStart) (if (rtl) layout.getLineRight(line) else layout.getLineLeft(line)) else layout.getHorizontalPosition(start, usePrimaryDirection = true)
            val b = if (stop == lineEnd) (if (rtl) layout.getLineLeft(line) else layout.getLineRight(line)) else layout.getHorizontalPosition(stop, usePrimaryDirection = true)
            val baseline = layout.getLineBaseline(line)
            val top = baseline - codePx * 1.0f
            val bottom = baseline + codePx * 0.32f
            drawRoundRect(fill, Offset(minOf(a, b), top), Size(kotlin.math.abs(b - a), bottom - top), CornerRadius(radius))
        }
    }
}
