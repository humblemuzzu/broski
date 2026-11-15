package com.muzammil.broski.feature.chat.transcript

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import com.muzammil.broski.design.MonoFamily
import uniffi.broski_core.InlineRun

/** How inline runs look: code in the monospace on a quiet fill, links in the accent and underlined. */
class InlineStyles(val code: SpanStyle, val link: TextLinkStyles) {
    companion object {
        val current: InlineStyles
            @Composable @ReadOnlyComposable
            get() {
                val scheme = MaterialTheme.colorScheme
                return InlineStyles(
                    code = SpanStyle(fontFamily = MonoFamily, background = scheme.surfaceContainerHighest, color = scheme.onSurface),
                    link = TextLinkStyles(SpanStyle(color = scheme.primary, textDecoration = TextDecoration.Underline)),
                )
            }
    }
}

/** The core's merged runs as one string: each run's styles, links that open in the browser. */
fun inlineText(runs: List<InlineRun>, styles: InlineStyles): AnnotatedString = buildAnnotatedString {
    runs.forEach { run ->
        val style = SpanStyle(
            fontWeight = if (run.strong) FontWeight.SemiBold else null,
            fontStyle = if (run.emphasis) FontStyle.Italic else null,
            textDecoration = if (run.strikethrough) TextDecoration.LineThrough else null,
        ).merge(if (run.code) styles.code else null)
        val link = run.link
        if (link != null) {
            withLink(LinkAnnotation.Url(link, styles.link)) { withStyle(style) { append(run.text) } }
        } else {
            withStyle(style) { append(run.text) }
        }
    }
}

@Composable
fun rememberInlineText(runs: List<InlineRun>): AnnotatedString {
    val styles = InlineStyles.current
    val key = styles.code.background to MaterialTheme.colorScheme.primary
    return remember(runs, key) { inlineText(runs, styles) }
}
