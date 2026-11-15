package com.muzammil.broski.design.code

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** What [CodeLines] needs to know of one line to place it; [accent] marks its leading edge. */
class ViewerLine(val text: AnnotatedString, val gutter: String, val background: Color? = null, val accent: Color? = null)

/**
 * Monospaced lines with a gutter that stays put: unwrapped, every line scrolls sideways together,
 * as far as the longest one reaches; wrapped, each line folds to the width. [header] goes above the
 * lines, scrolling with them. The text can be selected and copied.
 */
@Composable
fun CodeLines(
    lines: List<ViewerLine>,
    style: TextStyle,
    wrap: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
    header: LazyListScope.() -> Unit = {},
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val charWidth = remember(style) { measurer.measure("0", style).size.width.toFloat() }
    val gutterChars = remember(lines) { lines.maxOfOrNull { it.gutter.length } ?: 0 }
    val longest = remember(lines) { lines.maxOfOrNull { it.text.length } ?: 0 }
    val gutterWidth = with(density) { (charWidth * gutterChars).toDp() + GUTTER_PADDING * 2 }
    BoxWithConstraints(modifier) {
        val viewport = with(density) { (maxWidth - gutterWidth - TEXT_PADDING * 2).toPx() }
        val reach = (longest * charWidth - viewport).coerceAtLeast(0f)
        var offset by remember(lines, wrap) { mutableFloatStateOf(0f) }
        val scroll = rememberScrollableState { delta ->
            val next = (offset - delta).coerceIn(0f, reach)
            val used = offset - next
            offset = next
            used
        }
        SelectionContainer {
            LazyColumn(
                modifier = if (wrap) Modifier else Modifier.scrollable(scroll, Orientation.Horizontal),
                contentPadding = contentPadding,
            ) {
                header()
                items(lines.size, contentType = { "line" }) { index ->
                    CodeRow(lines[index], style, gutterWidth, wrap) { offset }
                }
            }
        }
    }
}

@Composable
private fun CodeRow(line: ViewerLine, style: TextStyle, gutterWidth: Dp, wrap: Boolean, offset: () -> Float) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (line.background != null) Modifier.background(line.background) else Modifier)
            .then(
                if (line.accent != null) {
                    Modifier.drawBehind { drawRect(line.accent, size = Size(ACCENT_WIDTH.toPx(), size.height)) }
                } else {
                    Modifier
                },
            ),
    ) {
        DisableSelection {
            Text(
                line.gutter,
                style = style,
                color = CodeColors.current.gutter,
                textAlign = TextAlign.End,
                softWrap = false,
                maxLines = 1,
                modifier = Modifier.width(gutterWidth).padding(horizontal = GUTTER_PADDING).clearAndSetSemantics {},
            )
        }
        Box(Modifier.weight(1f).clipToBounds().padding(horizontal = TEXT_PADDING)) {
            Text(
                line.text,
                style = style,
                softWrap = wrap,
                modifier = if (wrap) {
                    Modifier
                } else {
                    Modifier
                        .wrapContentWidth(Alignment.Start, unbounded = true)
                        .graphicsLayer { translationX = -offset() }
                },
            )
        }
    }
}

private val ACCENT_WIDTH = 3.dp
private val GUTTER_PADDING = 8.dp
private val TEXT_PADDING = 8.dp
