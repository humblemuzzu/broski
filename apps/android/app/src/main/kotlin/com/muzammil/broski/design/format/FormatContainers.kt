package com.muzammil.broski.design.format

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import uniffi.broski_core.CalloutKind
import uniffi.broski_core.ContainerKind
import uniffi.broski_core.FormatContainer
import uniffi.broski_core.ListMarker

/**
 * A block inside its quotes, callouts, list items and footnotes, outermost first. A container the
 * previous block shares draws up through the gap above this block, and one the next block shares
 * leaves its bottom open, so a quote's bar and a callout's card run on unbroken across blocks.
 */
@Composable
fun FormatContainers(
    containers: List<FormatContainer>,
    next: List<UInt>,
    gap: Dp,
    role: FormatRole,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(modifier) { Wrapped(containers, 0, next, gap, role, content) }
}

@Composable
private fun Wrapped(containers: List<FormatContainer>, index: Int, next: List<UInt>, gap: Dp, role: FormatRole, content: @Composable () -> Unit) {
    val outer = containers.getOrNull(index) ?: return content()
    val inner: @Composable () -> Unit = { Wrapped(containers, index + 1, next, gap, role, content) }
    val above = if (outer.first) 0.dp else gap
    when (val kind = outer.kind) {
        ContainerKind.Quote -> QuoteFrame(above, inner)
        is ContainerKind.Callout -> CalloutFrame(kind.kind, outer.first, outer.id in next, above, inner)
        is ContainerKind.Item -> ListItemFrame(kind.marker, kind.depth, kind.width, outer.first, role, inner)
        is ContainerKind.Footnote -> FootnoteFrame(kind.label, outer.first, inner)
    }
}

@Composable
private fun QuoteFrame(above: Dp, content: @Composable () -> Unit) {
    val bar = MaterialTheme.colorScheme.outlineVariant
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

@Composable
private fun CalloutFrame(kind: CalloutKind, first: Boolean, continues: Boolean, above: Dp, content: @Composable () -> Unit) {
    val tint = kind.tint()
    val pad = FormatTokens.calloutPadding
    Column(
        Modifier.fillMaxWidth()
            .drawBehind { callout(tint.copy(alpha = 0.1f), first, continues, above.toPx()) }
            .padding(start = pad, end = pad, top = if (first) pad - 2.dp else 0.dp, bottom = if (continues) 0.dp else pad - 2.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (first) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.semantics { heading() }) {
                Icon(painterResource(kind.icon), contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
                Text(stringResource(kind.title), style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold), color = tint)
            }
        }
        content()
    }
}

/** The callout's card: rounded where it starts and ends, drawn up through the gap above it. */
private fun DrawScope.callout(fill: Color, first: Boolean, continues: Boolean, above: Float) {
    val radius = FormatTokens.calloutRadius.toPx()
    val top = if (first) 0f else -above
    val topRadius = if (first) radius else 0f
    val bottomRadius = if (continues) 0f else radius
    val path = Path().apply {
        addRoundRect(
            RoundRect(
                left = 0f, top = top, right = size.width, bottom = size.height,
                topLeftCornerRadius = CornerRadius(topRadius), topRightCornerRadius = CornerRadius(topRadius),
                bottomRightCornerRadius = CornerRadius(bottomRadius), bottomLeftCornerRadius = CornerRadius(bottomRadius),
            ),
        )
    }
    drawPath(path, fill)
}

/**
 * A list item: its marker in a gutter as wide as the list's widest (so `9.` and `10.` line up), the
 * text beside it; past four levels the indent stops growing and the marker sits inline.
 */
@Composable
private fun ListItemFrame(marker: ListMarker, depth: UInt, width: UInt, first: Boolean, role: FormatRole, content: @Composable () -> Unit) {
    val done = marker is ListMarker.Task && marker.checked
    Row(horizontalArrangement = Arrangement.spacedBy(FormatTokens.markerGap), modifier = Modifier.fillMaxWidth()) {
        if (depth < FormatTokens.MAX_LIST_INDENT) {
            Box(Modifier.width(gutter(marker, width, role)), contentAlignment = Alignment.TopEnd) {
                if (first) Marker(marker, depth, role)
            }
        } else if (first) {
            Marker(marker, depth, role)
        }
        Box(Modifier.weight(1f).alpha(if (done) 0.55f else 1f)) { content() }
    }
}

/** A numbered list's gutter: its widest marker (`width` characters, the dot included) measured in the marker's own style. */
@Composable
private fun gutter(marker: ListMarker, width: UInt, role: FormatRole): Dp {
    if (marker !is ListMarker.Number) return FormatTokens.bulletGutter
    val measurer = rememberTextMeasurer()
    val style = role.textStyle().copy(fontFeatureSettings = "tnum")
    val widest = "0".repeat(width.toInt().coerceAtLeast(2) - 1) + "."
    val pixels = remember(widest, style, measurer) { measurer.measure(widest, style).size.width }
    return with(LocalDensity.current) { pixels.toDp() }
}

@Composable
private fun Marker(marker: ListMarker, depth: UInt, role: FormatRole) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val style = role.textStyle()
    when (marker) {
        ListMarker.Bullet -> {
            val bullet = stringResource(R.string.format_bullet)
            Text(BULLETS[(depth % BULLETS.size.toUInt()).toInt()], style = style, color = muted, modifier = Modifier.semantics { contentDescription = bullet })
        }
        is ListMarker.Number -> Text(
            "${marker.value}${if (marker.paren) ")" else "."}",
            style = style.copy(fontFeatureSettings = "tnum", textAlign = TextAlign.End),
            color = muted,
        )
        is ListMarker.Task -> Icon(
            painterResource(if (marker.checked) R.drawable.ic_check_circle else R.drawable.ic_radio_unchecked),
            contentDescription = stringResource(if (marker.checked) R.string.format_task_done else R.string.format_task_todo),
            tint = if (marker.checked) BroskiTheme.semantic.done else muted,
            modifier = Modifier.padding(top = 3.dp).size(with(LocalDensity.current) { style.fontSize.toDp() } + 2.dp),
        )
    }
}

private val BULLETS = listOf("•", "◦", "▪")

@Composable
private fun FootnoteFrame(label: String, first: Boolean, content: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(FormatTokens.markerGap), modifier = Modifier.fillMaxWidth()) {
        Text(
            if (first) label else "",
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End),
            color = formatLink,
            modifier = Modifier.width(16.dp).padding(top = 2.dp),
        )
        Box(Modifier.weight(1f)) { content() }
    }
}
