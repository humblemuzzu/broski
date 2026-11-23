package com.muzammil.broski.design.format

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
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
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.ResolvedTextDirection
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withAnnotation
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.muzammil.broski.design.MonoFamily
import uniffi.broski_core.FormatLink
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.LinkKind

@Stable
class FormatLinks(val openFile: (path: String, line: Int?) -> Unit)

val LocalFormatLinks = staticCompositionLocalOf<FormatLinks?> { null }

data class SpanLook(
    val codeSize: TextUnit,
    val link: Color,
    val path: Color,
    val muted: Color,
    val underlinesLinks: Boolean,
    val opensFiles: Boolean = true,
    val strong: Color = Color.Unspecified,
    val inlineCode: Color = Color.Unspecified,
)

@Composable
fun rememberSpans(spans: List<FormatSpan>, look: SpanLook): AnnotatedString {
    val context = LocalContext.current
    val links = LocalFormatLinks.current
    val opens = look.copy(opensFiles = look.opensFiles && links != null)
    return remember(spans, opens, links) { formatSpans(spans, opens) { link -> openLink(context, links, link) } }
}

/** Inline code, paths, and math render cleanly without boxes; only unloaded image links use a chip pill. */
fun formatSpans(spans: List<FormatSpan>, look: SpanLook, open: (FormatLink) -> Unit): AnnotatedString = buildAnnotatedString {
    spans.forEach { span ->
        val link = span.link
        when {
            link != null && link.image -> withLink(annotation(link, look, open)) {
                withAnnotation(CHIP, CHIP_IMAGE) {
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
            link != null && opens(link, look) -> withLink(annotation(link, look, open)) {
                appendStyled(span, look, linked = true)
            }
            else -> appendStyled(span, look, linked = false)
        }
    }
}

private fun opens(link: FormatLink, look: SpanLook): Boolean = when (link.kind) {
    LinkKind.Web, LinkKind.Mail -> true
    is LinkKind.File -> look.opensFiles
    LinkKind.Footnote, LinkKind.Inert -> false
}

private fun AnnotatedString.Builder.appendStyled(span: FormatSpan, look: SpanLook, linked: Boolean) {
    val mono = span.code || span.math || span.html
    val color = when {
        linked -> Color.Unspecified
        span.strike || span.html -> look.muted
        span.strong -> look.strong
        span.code || span.math -> look.inlineCode
        else -> Color.Unspecified
    }
    val style = SpanStyle(
        fontWeight = if (span.strong) FontWeight.SemiBold else null,
        fontStyle = if (span.emphasis || span.math) FontStyle.Italic else null,
        textDecoration = if (span.strike) TextDecoration.LineThrough else null,
        color = color,
        fontFamily = if (mono) MonoFamily else null,
        fontSize = if (span.code || span.math) look.codeSize else TextUnit.Unspecified,
    )
    withStyle(style) { append(span.text) }
}

private fun annotation(link: FormatLink, look: SpanLook, open: (FormatLink) -> Unit): LinkAnnotation {
    val file = link.kind is LinkKind.File
    val decoration = if (look.underlinesLinks && !file) TextDecoration.Underline else null
    val styles = TextLinkStyles(SpanStyle(color = if (file) look.path else look.link, textDecoration = decoration))
    return LinkAnnotation.Clickable(link.target, styles) { open(link) }
}

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

fun inlineCodeSize(body: TextUnit): TextUnit = body * FormatTokens.INLINE_CODE_SCALE

@Composable
fun SpanText(text: AnnotatedString, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified, codeSize: TextUnit) {
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val fill = formatImageChipFill
    val density = LocalDensity.current
    val radius = with(density) { FormatTokens.inlineCodeRadius.toPx() }
    val padX = with(density) { 1.dp.toPx() }
    val codePx = with(density) { codeSize.toPx() }
    Text(
        text,
        style = style,
        color = color,
        onTextLayout = { layout = it },
        modifier = modifier.drawBehind {
            layout?.let { drawChips(it, text, fill, radius, padX, codePx) }
        },
    )
}

internal const val CHIP = "chip"
internal const val CHIP_IMAGE = "image"

private fun DrawScope.drawChips(
    layout: TextLayoutResult,
    text: AnnotatedString,
    fill: Color,
    radius: Float,
    padX: Float,
    codePx: Float,
) {
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
            val rtl = layout.getParagraphDirection(start) == ResolvedTextDirection.Rtl
            val a = if (start == lineStart) (if (rtl) layout.getLineRight(line) else layout.getLineLeft(line)) else layout.getHorizontalPosition(start, usePrimaryDirection = true)
            val b = if (stop == lineEnd) (if (rtl) layout.getLineLeft(line) else layout.getLineRight(line)) else layout.getHorizontalPosition(stop, usePrimaryDirection = true)
            val baseline = layout.getLineBaseline(line)
            val top = baseline - codePx * 1.02f
            val bottom = baseline + codePx * 0.34f
            val left = minOf(a, b) - padX
            val width = kotlin.math.abs(b - a) + padX * 2f
            drawRoundRect(fill, Offset(left, top), Size(width, bottom - top), CornerRadius(radius))
        }
    }
}
