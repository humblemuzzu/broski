package com.muzammil.broski.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

/**
 * The grouped list iOS draws in its inset style: a grey screen with white cards in light, black with
 * raised grey cards in dark, cards 16 dp in from the edges with their rows joined by inset hairlines.
 */
object Grouped {
    val cardRadius = 26.dp
    val margin = 16.dp

    /** In a sheet the dark grey rises a step, as iOS raises a sheet over the screen. */
    val screen: Color
        @Composable @ReadOnlyComposable
        get() = when {
            !isDark() -> MaterialTheme.colorScheme.surfaceContainer
            LocalGroupedSheet.current -> MaterialTheme.colorScheme.surfaceContainerHigh
            else -> MaterialTheme.colorScheme.surface
        }

    val card: Color
        @Composable @ReadOnlyComposable
        get() = when {
            !isDark() -> MaterialTheme.colorScheme.surfaceContainerLowest
            LocalGroupedSheet.current -> MaterialTheme.colorScheme.surfaceContainerHighest
            else -> MaterialTheme.colorScheme.surfaceContainerHigh
        }

    /** Row [index] of [count]: the group's rounded corners on its first and last rows only. */
    fun shape(index: Int, count: Int): Shape {
        val top = if (index == 0) cardRadius else 0.dp
        val bottom = if (index == count - 1) cardRadius else 0.dp
        return RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)
    }
}

/** Whether the grouped rows under it sit in a sheet, whose greys are a step lighter in dark. */
val LocalGroupedSheet = staticCompositionLocalOf { false }

@Composable
@ReadOnlyComposable
private fun isDark(): Boolean = MaterialTheme.colorScheme.surface.luminance() < 0.5f

/**
 * A screen's top bar drawn over its content: the bar's row in the screen's own colour, so nothing
 * reads through between its controls and no band shows, then a short fade below it, so rows slide
 * softly under the bar as they do under iOS's soft scroll edge. Measured without the fade, which
 * draws past the bar's bottom.
 */
@Composable
fun SoftTopBar(color: Color, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .drawBehind {
                drawRect(color)
                val fade = SoftEdge.toPx()
                drawRect(
                    Brush.verticalGradient(listOf(color, color.copy(alpha = 0f)), startY = size.height, endY = size.height + fade),
                    topLeft = Offset(0f, size.height),
                    size = Size(size.width, fade),
                )
            }
            .statusBarsPadding(),
        content = content,
    )
}

private val SoftEdge = 20.dp
