package com.muzammil.broski.design.format

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import uniffi.broski_core.CalloutKind
import uniffi.broski_core.ContainerKind
import uniffi.broski_core.FormatContainer
import uniffi.broski_core.ListMarker

@Composable
fun FormatContainers(
    containers: List<FormatContainer>,
    next: List<UInt>,
    gap: Dp,
    role: FormatRole,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val segments = remember(containers) { groupSegments(containers) }
    Box(modifier) { WrappedSegments(segments, 0, next, gap, role, content) }
}

private sealed interface ContainerSegment {
    data class Quote(val container: FormatContainer) : ContainerSegment
    data class Callout(val container: FormatContainer, val kind: CalloutKind) : ContainerSegment
    data class ListRun(val items: List<FormatContainer>) : ContainerSegment
    data class Footnote(val container: FormatContainer, val label: String) : ContainerSegment
}

private fun groupSegments(containers: List<FormatContainer>): List<ContainerSegment> {
    val result = mutableListOf<ContainerSegment>()
    val items = mutableListOf<FormatContainer>()
    fun flush() {
        if (items.isNotEmpty()) {
            result += ContainerSegment.ListRun(items.toList())
            items.clear()
        }
    }
    for (container in containers) {
        when (val kind = container.kind) {
            is ContainerKind.Item -> items += container
            ContainerKind.Quote -> {
                flush()
                result += ContainerSegment.Quote(container)
            }
            is ContainerKind.Callout -> {
                flush()
                result += ContainerSegment.Callout(container, kind.kind)
            }
            is ContainerKind.Footnote -> {
                flush()
                result += ContainerSegment.Footnote(container, kind.label)
            }
        }
    }
    flush()
    return result
}

@Composable
private fun WrappedSegments(
    segments: List<ContainerSegment>,
    index: Int,
    next: List<UInt>,
    gap: Dp,
    role: FormatRole,
    content: @Composable () -> Unit,
) {
    val segment = segments.getOrNull(index) ?: return content()
    val inner: @Composable () -> Unit = { WrappedSegments(segments, index + 1, next, gap, role, content) }
    when (segment) {
        is ContainerSegment.Quote -> QuoteFrame(if (segment.container.first) 0.dp else gap, inner)
        is ContainerSegment.Callout -> CalloutFrame(
            segment.kind,
            segment.container.first,
            segment.container.id in next,
            if (segment.container.first) 0.dp else gap,
            inner,
        )
        is ContainerSegment.ListRun -> FlatListFrame(segment.items, role, inner)
        is ContainerSegment.Footnote -> FootnoteFrame(segment.label, segment.container.first, inner)
    }
}

@Composable
private fun QuoteFrame(above: Dp, content: @Composable () -> Unit) {
    val bar = formatMarkerColor.copy(alpha = 0.5f)
    CompositionLocalProvider(LocalInQuote provides true) {
        Box(
            Modifier.fillMaxWidth()
                .drawBehind {
                    val width = FormatTokens.quoteBarWidth.toPx()
                    val top = -above.toPx()
                    drawRoundRect(bar, Offset(0f, top), Size(width, size.height - top), CornerRadius(width / 2))
                }
                .padding(start = FormatTokens.quoteBarWidth + FormatTokens.quoteGap),
        ) { content() }
    }
}

@Composable
private fun CalloutFrame(kind: CalloutKind, first: Boolean, continues: Boolean, above: Dp, content: @Composable () -> Unit) {
    val tint = kind.tint()
    val pad = FormatTokens.calloutPadding
    val barWidth = FormatTokens.calloutBarWidth
    Column(
        Modifier.fillMaxWidth()
            .drawBehind { callout(tint, first, continues, above.toPx(), barWidth.toPx()) }
            .padding(
                start = pad + barWidth,
                end = pad,
                top = if (first) pad - 1.dp else 0.dp,
                bottom = if (continues) 0.dp else pad - 1.dp,
            ),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (first) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.semantics { heading() }) {
                Icon(painterResource(kind.icon), contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
                Text(stringResource(kind.title), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = tint)
            }
        }
        content()
    }
}

private fun DrawScope.callout(tint: Color, first: Boolean, continues: Boolean, above: Float, barWidth: Float) {
    val radius = FormatTokens.calloutRadius.toPx()
    val top = if (first) 0f else -above
    val topRadius = if (first) radius else 0f
    val bottomRadius = if (continues) 0f else radius
    val rect = RoundRect(
        left = 0f, top = top, right = size.width, bottom = size.height,
        topLeftCornerRadius = CornerRadius(topRadius), topRightCornerRadius = CornerRadius(topRadius),
        bottomRightCornerRadius = CornerRadius(bottomRadius), bottomLeftCornerRadius = CornerRadius(bottomRadius),
    )
    val path = Path().apply { addRoundRect(rect) }
    drawPath(path, tint.copy(alpha = 0.08f))
    drawRoundRect(
        tint.copy(alpha = 0.75f),
        Offset(0f, top),
        Size(barWidth, size.height - top),
        CornerRadius(topRadius.coerceAtMost(barWidth)),
    )
}

@Composable
private fun FlatListFrame(items: List<FormatContainer>, role: FormatRole, content: @Composable () -> Unit) {
    val leaf = items.last()
    val itemKind = leaf.kind as ContainerKind.Item
    val marker = itemKind.marker
    val visualDepth = items.size - 1
    val fontScale = LocalDensity.current.fontScale
    val baseIndent = FormatTokens.listBaseIndentDp(visualDepth, fontScale)
    val bulletBox = (FormatTokens.bulletBoxWidth.value * fontScale.coerceIn(0.85f, 1.35f)).dp
    val done = marker is ListMarker.Task && marker.checked
    val spacing = when (marker) {
        ListMarker.Bullet -> FormatTokens.bulletGap
        is ListMarker.Number -> FormatTokens.numberGap
        is ListMarker.Task -> FormatTokens.taskGap
    }
    Row(
        horizontalArrangement = Arrangement.spacedBy(spacing),
        modifier = Modifier.fillMaxWidth().padding(start = baseIndent),
    ) {
        val markerMod = when (marker) {
            is ListMarker.Number -> Modifier.widthIn(min = (16f * fontScale.coerceIn(0.85f, 1.4f)).dp)
            else -> Modifier.width(gutter(marker, bulletBox))
        }
        Box(markerMod, contentAlignment = Alignment.TopStart) {
            if (leaf.first) {
                Marker(marker, visualDepth, role, bulletBox)
            } else if (marker is ListMarker.Number) {
                Box(Modifier.alpha(0f)) { Marker(marker, visualDepth, role, bulletBox) }
            }
        }
        Box(Modifier.weight(1f).alpha(if (done) 0.55f else 1f)) { content() }
    }
}

@Composable
private fun gutter(marker: ListMarker, bulletBox: Dp): Dp {
    val density = LocalDensity.current
    return when (marker) {
        ListMarker.Bullet -> bulletBox
        is ListMarker.Task -> (FormatTokens.taskGutter.value * density.fontScale.coerceIn(0.85f, 1.4f)).dp
        is ListMarker.Number -> (16f * density.fontScale.coerceIn(0.85f, 1.4f)).dp
    }
}

@Composable
private fun Marker(marker: ListMarker, visualDepth: Int, role: FormatRole, bulletBox: Dp) {
    val primaryDot = formatBulletPrimary
    val nestedDot = formatBulletNested
    val muted = formatMarkerColor
    val style = role.textStyle()
    val density = LocalDensity.current
    val lineHeightDp = with(density) { style.lineHeight.toDp() }
    when (marker) {
        ListMarker.Bullet -> {
            val bulletDesc = stringResource(R.string.format_bullet)
            Box(
                Modifier.size(width = bulletBox, height = lineHeightDp).semantics { contentDescription = bulletDesc },
                contentAlignment = Alignment.Center,
            ) {
                when (visualDepth) {
                    0 -> {
                        val dotDp = with(density) { (style.fontSize * 0.31f).toDp() }.coerceAtLeast(4.5.dp)
                        Canvas(Modifier.size(dotDp)) { drawCircle(primaryDot) }
                    }
                    1 -> {
                        val dotDp = with(density) { (style.fontSize * 0.25f).toDp() }.coerceAtLeast(3.6.dp)
                        Canvas(Modifier.size(dotDp)) { drawCircle(nestedDot) }
                    }
                    else -> {
                        val widthDp = with(density) { (style.fontSize * 0.34f).toDp() }.coerceAtLeast(5.0.dp)
                        Canvas(Modifier.size(width = widthDp, height = 1.4.dp)) {
                            drawRoundRect(nestedDot, cornerRadius = CornerRadius(size.height / 2f))
                        }
                    }
                }
            }
        }
        is ListMarker.Number -> Text(
            "${marker.value}${if (marker.paren) ")" else "."}",
            style = style.copy(fontSize = style.fontSize * 0.94f, fontFeatureSettings = "tnum", textAlign = TextAlign.Start),
            color = muted,
        )
        is ListMarker.Task -> {
            val iconSize = with(density) { (style.fontSize * 0.95f).toDp() }
            Box(Modifier.size(width = iconSize, height = lineHeightDp), contentAlignment = Alignment.Center) {
                Icon(
                    painterResource(if (marker.checked) R.drawable.ic_check_circle else R.drawable.ic_radio_unchecked),
                    contentDescription = stringResource(if (marker.checked) R.string.format_task_done else R.string.format_task_todo),
                    tint = if (marker.checked) BroskiTheme.semantic.done else muted,
                    modifier = Modifier.size(iconSize),
                )
            }
        }
    }
}

@Composable
private fun FootnoteFrame(label: String, first: Boolean, content: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(FormatTokens.numberGap), modifier = Modifier.fillMaxWidth()) {
        Text(
            if (first) label else "",
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Start),
            color = formatLink,
            modifier = Modifier.width(16.dp).padding(top = 2.dp),
        )
        Box(Modifier.weight(1f)) { content() }
    }
}
