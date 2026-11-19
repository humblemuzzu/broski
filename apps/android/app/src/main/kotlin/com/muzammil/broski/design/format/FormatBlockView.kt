package com.muzammil.broski.design.format

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.mono
import uniffi.broski_core.FormatBlock
import uniffi.broski_core.FormatContent
import uniffi.broski_core.FormatSpan
import uniffi.broski_core.TextDirection

/**
 * One block of formatted text with the containers around it and the space above it. [next] is the
 * containers of the block after it, which say where a quote's bar or a callout's card ends;
 * [streaming] while the text is still arriving (a table's columns only grow, code is coloured line
 * by line).
 */
@Composable
fun FormatBlockView(
    block: FormatBlock,
    modifier: Modifier = Modifier,
    role: FormatRole = FormatRole.Page,
    next: List<UInt> = emptyList(),
    streaming: Boolean = false,
) {
    val gap = FormatTokens.spacing(block.spacing, quiet = role == FormatRole.Quiet, compact = LocalReading.current.compact)
    val prose = block.content !is FormatContent.Code && block.content !is FormatContent.Table
    ReadingTextSize {
        Box(modifier.fillMaxWidth().padding(top = gap), contentAlignment = Alignment.TopCenter) {
            FormatContainers(
                block.containers,
                next,
                gap,
                role,
                (if (prose) Modifier.widthIn(max = FormatTokens.readableWidth) else Modifier).fillMaxWidth(),
            ) {
                FormatContentView(block, role, streaming)
            }
        }
    }
}

/** What a block holds, drawn by its kind. */
@Composable
fun FormatContentView(block: FormatBlock, role: FormatRole, streaming: Boolean) {
    val bleed = if (role == FormatRole.Page && block.containers.isEmpty()) LocalFormatBleed.current else 0.dp
    when (val content = block.content) {
        is FormatContent.Paragraph -> Prose(content.spans, role.textStyle(), role.bodyColor(), block.direction, strong = role.boldColor())
        is FormatContent.Heading -> Prose(
            content.spans,
            role.headingStyle(content.level),
            if (content.level >= 4.toUByte()) MaterialTheme.colorScheme.onSurfaceVariant else role.color(),
            block.direction,
            Modifier.semantics { heading() },
        )
        is FormatContent.Code -> FormatCodeBlock(content.code, streaming, bleed)
        is FormatContent.Table -> FormatTable(content.table, streaming, bleed)
        is FormatContent.Math -> MathBlock(content.tex)
        is FormatContent.Html -> Surface(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Text(content.text, style = MaterialTheme.typography.bodySmall.mono(), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(10.dp))
        }
        FormatContent.Rule -> Box(Modifier.fillMaxWidth().height(0.dp))
    }
}

/** Lays the content out [bleed] wider on each side than its column, so it reaches the screen's edges. */
fun Modifier.bleed(bleed: Dp): Modifier = if (bleed == 0.dp) this else layout { measurable, constraints ->
    val extra = bleed.roundToPx()
    val wide = constraints.copy(minWidth = constraints.minWidth + 2 * extra, maxWidth = constraints.maxWidth + 2 * extra)
    val placeable = measurable.measure(wide)
    layout(constraints.maxWidth, placeable.height) { placeable.place(-extra, 0) }
}

/** A paragraph or a heading: its spans styled, laid out in the block's own direction. */
@Composable
fun Prose(spans: List<FormatSpan>, style: TextStyle, color: Color, direction: TextDirection, modifier: Modifier = Modifier, strong: Color = Color.Unspecified) {
    val look = spanLook(style).copy(strong = strong)
    val text = rememberSpans(spans, look)
    val layout = if (direction == TextDirection.RIGHT_TO_LEFT) LayoutDirection.Rtl else LayoutDirection.Ltr
    CompositionLocalProvider(LocalLayoutDirection provides layout) {
        SpanText(if (spans.isEmpty()) AnnotatedString(" ") else text, style, modifier.fillMaxWidth(), color, look.codeSize)
    }
}

/** How spans look in text of [style]. */
@Composable
fun spanLook(style: TextStyle): SpanLook = SpanLook(
    codeSize = inlineCodeSize(style.fontSize),
    link = formatLink,
    path = formatPath,
    muted = MaterialTheme.colorScheme.onSurfaceVariant,
    underlinesLinks = LocalReading.current.underlinesLinks,
)

/** Display math as its TeX: centred, italic, monospaced. No math library draws it. */
@Composable
private fun MathBlock(tex: String) {
    val description = stringResource(R.string.format_math, tex)
    Surface(
        Modifier.fillMaxWidth().semantics { contentDescription = description },
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Text(
            tex,
            style = MaterialTheme.typography.bodyLarge.mono().copy(fontStyle = FontStyle.Italic, textAlign = TextAlign.Center),
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}
