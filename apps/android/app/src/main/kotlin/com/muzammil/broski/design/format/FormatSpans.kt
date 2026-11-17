package com.muzammil.broski.design.format

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.core.net.toUri
import com.muzammil.broski.design.MonoFamily
import uniffi.broski_core.FormatLink
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.LinkKind

/**
 * What a path in agent text opens: the file at its line on the machine the text belongs to. The chat
 * provides it; elsewhere a path's link copies nothing and opens nothing.
 */
@Stable
class FormatLinks(val openFile: (path: String, line: Int?) -> Unit)

val LocalFormatLinks = staticCompositionLocalOf<FormatLinks?> { null }

/** How spans are styled in one text. */
data class SpanLook(val codeSize: TextUnit, val codeFill: Color, val link: Color, val muted: Color, val underlinesLinks: Boolean)

/** Spans as styled text with their links live: pages in Custom Tabs, addresses in mail, paths in Files. */
@Composable
fun rememberSpans(spans: List<FormatSpan>, look: SpanLook): AnnotatedString {
    val context = LocalContext.current
    val links = LocalFormatLinks.current
    return remember(spans, look, links) { formatSpans(spans, look) { link -> openLink(context, links, link) } }
}

fun formatSpans(spans: List<FormatSpan>, look: SpanLook, open: (FormatLink) -> Unit): AnnotatedString = buildAnnotatedString {
    spans.forEach { span ->
        val link = span.link
        when {
            link != null && link.image -> withLink(annotation(link, look, open)) {
                withStyle(SpanStyle(background = look.codeFill, fontWeight = FontWeight.Medium)) {
                    append("\u202F${span.text.ifEmpty { "Image" }} · ${link.target.toUri().host ?: link.target}\u202F")
                }
            }
            link != null && link.kind == LinkKind.Footnote -> withStyle(
                SpanStyle(baselineShift = BaselineShift.Superscript, color = look.link, fontWeight = FontWeight.SemiBold),
            ) { append(span.text) }
            link != null && link.kind != LinkKind.Inert -> withLink(annotation(link, look, open)) { appendStyled(span, look) }
            else -> appendStyled(span, look)
        }
    }
}

private fun AnnotatedString.Builder.appendStyled(span: FormatSpan, look: SpanLook) {
    val chip = span.code || span.math
    val style = SpanStyle(
        fontWeight = if (span.strong) FontWeight.SemiBold else null,
        fontStyle = if (span.emphasis || span.math) FontStyle.Italic else null,
        textDecoration = if (span.strike) TextDecoration.LineThrough else null,
        color = if (span.strike || span.html) look.muted else Color.Unspecified,
        fontFamily = if (chip || span.html) MonoFamily else null,
        fontSize = if (chip) look.codeSize else TextUnit.Unspecified,
        background = if (chip) look.codeFill else Color.Unspecified,
    )
    withStyle(style) { append(if (chip) "\u202F${span.text}\u202F" else span.text) }
}

private fun annotation(link: FormatLink, look: SpanLook, open: (FormatLink) -> Unit): LinkAnnotation {
    val styles = TextLinkStyles(SpanStyle(color = look.link, textDecoration = if (look.underlinesLinks) TextDecoration.Underline else null))
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
