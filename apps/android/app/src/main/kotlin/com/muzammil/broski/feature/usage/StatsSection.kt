package com.muzammil.broski.feature.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.IosText
import kotlin.math.max
import kotlin.math.min

/** A titled group of the Stats tab, as Limits titles its plans: the title over one card. */
@Composable
fun StatsSection(title: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            title,
            style = IosText.title3,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 4.dp).semantics { heading() },
        )
        StatsCard(Modifier, Arrangement.spacedBy(16.dp), content)
    }
}

/** The card every Stats and Limits group sits on: 18 dp in, 28 dp corners. */
@Composable
fun StatsCard(modifier: Modifier = Modifier, arrangement: Arrangement.Vertical = Arrangement.Top, content: @Composable () -> Unit) {
    Column(
        modifier.fillMaxWidth().background(Grouped.card, RoundedCornerShape(28.dp)).padding(18.dp),
        verticalArrangement = arrangement,
    ) { content() }
}

/** One part of a [ShareBar]: its share of the whole and its colour. */
data class SharePart(val value: Double, val color: Color)

/** One whole split into its parts, side by side in their colours, 2 dp apart. */
@Composable
fun ShareBar(parts: List<SharePart>, modifier: Modifier = Modifier) {
    val shown = parts.filter { it.value > 0.0 }
    val total = shown.sumOf { it.value }
    Canvas(modifier.fillMaxWidth().height(8.dp).clip(CircleShape).clearAndSetSemantics {}) {
        val gap = 2.dp.toPx()
        val usable = size.width - max(0, shown.size - 1) * gap
        var x = 0f
        for (part in shown) {
            val width = max(2.dp.toPx(), (usable * part.value / max(total, Double.MIN_VALUE)).toFloat())
            drawRect(part.color, Offset(x, 0f), Size(width, size.height))
            x += width + gap
        }
    }
}

/** How much of the largest a row is, as the Limits bars draw what is left. */
@Composable
fun Meter(fraction: Double, tint: Color, modifier: Modifier = Modifier) {
    val track = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f)
    Canvas(modifier.fillMaxWidth().height(4.dp).clearAndSetSemantics {}) {
        drawRoundRect(track, cornerRadius = CornerRadius(size.height / 2))
        val width = max(4.dp.toPx(), size.width * min(1.0, fraction).toFloat())
        drawRoundRect(tint.copy(alpha = 0.6f), size = Size(width, size.height), cornerRadius = CornerRadius(size.height / 2))
    }
}
