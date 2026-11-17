package com.muzammil.broski.design.format

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.DialogProperties

/**
 * A dialog over the whole screen, drawn edge to edge so its own scaffold keeps clear of the bars and
 * a sideways phone's notch; a dialog that fits its window to them sits off-centre when turned.
 */
internal val FullScreenDialog = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)

/** A folded block's foot fading out, so the cut reads as more to come. */
fun Modifier.fadeFoot(on: Boolean): Modifier = if (!on) this else fading { size ->
    Brush.verticalGradient(0.8f to Color.Black, 1f to Color.Black.copy(alpha = 0.35f), startY = 0f, endY = size.height)
}

/** The end edge fading out over [width] while more of a sideways-scrolling table is past it. */
fun Modifier.fadeEnd(on: Boolean, width: Dp): Modifier = if (!on) this else this.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        val fade = width.toPx().coerceAtMost(size.width)
        val start = if (layoutDirection == LayoutDirection.Ltr) size.width - fade else 0f
        val colors = if (layoutDirection == LayoutDirection.Ltr) listOf(Color.Black, Color.Black.copy(alpha = 0.15f)) else listOf(Color.Black.copy(alpha = 0.15f), Color.Black)
        drawRect(Brush.horizontalGradient(colors, startX = start, endX = start + fade), Offset(start, 0f), Size(fade, size.height), blendMode = BlendMode.DstIn)
    }

/** The content kept where [mask] is opaque, faded where it is not. */
private fun Modifier.fading(mask: (Size) -> Brush): Modifier = this.graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        drawRect(mask(size), blendMode = BlendMode.DstIn)
    }
