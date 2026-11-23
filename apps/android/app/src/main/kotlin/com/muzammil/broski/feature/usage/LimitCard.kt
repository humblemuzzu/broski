package com.muzammil.broski.feature.usage

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.IosText
import com.muzammil.broski.core.usage.LimitWindow
import com.muzammil.broski.core.usage.PlanIds

/** A plan's own colour: Claude's coral, Antigravity's blue, any other a neutral slate. */
@Composable
fun planTint(plan: String): Color {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    return when (plan) {
        PlanIds.CLAUDE -> if (dark) Color(0xFFD97757) else Color(0xFFC15F3C)
        PlanIds.ANTIGRAVITY -> if (dark) Color(0xFF5B9DFF) else Color(0xFF1A73E8)
        else -> if (dark) Color(0xFF94A3B8) else Color(0xFF5B6577)
    }
}

/** The plan's mark in its own colours: Claude's spark, Antigravity's arch, else its initial. */
@Composable
fun PlanGlyph(plan: String, name: String, size: Dp = 20.dp) {
    when (plan) {
        PlanIds.CLAUDE -> Icon(painterResource(R.drawable.ic_agent_claude), contentDescription = null, tint = Color(0xFFD97757), modifier = Modifier.size(size))
        PlanIds.ANTIGRAVITY -> Image(painterResource(R.drawable.ic_plan_antigravity), contentDescription = null, modifier = Modifier.size(size * 0.9f))
        else -> Text(name.take(1).uppercase(), fontSize = (size.value * 0.8f).sp, fontWeight = FontWeight.Bold, color = planTint(plan))
    }
}

/**
 * What is left of a limit as a filled capsule in the plan's muted colour, and a thin mark where an
 * even pace would leave it: fill past the mark means room to spare.
 */
@Composable
fun UsageBar(plan: String, window: LimitWindow, nowMs: Long, modifier: Modifier = Modifier, height: Dp = 10.dp) {
    val left = window.left(nowMs).toFloat()
    val evenPace = window.elapsed(nowMs)?.let { 1f - it.toFloat() }
    val track = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f)
    val fill = planTint(plan).copy(alpha = 0.6f)
    val mark = MaterialTheme.colorScheme.onSurface
    BoxWithConstraints(modifier.fillMaxWidth().height(height * 1.9f).clearAndSetSemantics {}, contentAlignment = Alignment.CenterStart) {
        val width = maxWidth
        Box(Modifier.fillMaxWidth().height(height).background(track, CircleShape))
        if (left > 0f) {
            Box(Modifier.width((width * left).coerceAtLeast(height)).height(height).background(fill, CircleShape))
        }
        if (evenPace != null) {
            val markWidth = maxOf(2.dp, height * 0.25f)
            Box(
                Modifier
                    .offset(x = (width * evenPace - markWidth / 2).coerceIn(0.dp, width - markWidth))
                    .width(markWidth)
                    .height(height * 1.9f)
                    .background(mark, CircleShape),
            )
        }
    }
}

/** One limit: what it covers and where its pace stands, how much is left as the figure to read, the bar, when it starts over. */
@Composable
fun LimitCard(plan: String, window: LimitWindow, nowMs: Long, modifier: Modifier = Modifier) {
    val resources = LocalResources.current
    val pace = window.paceWords(resources, nowMs)
    val reset = window.resetWords(resources, nowMs)
    val left = window.leftPercent(nowMs)
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    StatsCard(
        modifier.semantics(mergeDescendants = true) {
            contentDescription = listOfNotNull(window.label, resources.getString(R.string.usage_left_spoken, left), pace, reset).joinToString(", ")
        },
        Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(window.label, style = IosText.subheadline, fontWeight = FontWeight.Medium, color = secondary, maxLines = 1, modifier = Modifier.weight(1f).alignByBaseline())
            pace?.let { Text(it, style = IosText.footnote, fontWeight = FontWeight.Medium, color = secondary, maxLines = 1, modifier = Modifier.alignByBaseline()) }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            NumericText(left, IosText.figure)
            Text(stringResource(R.string.usage_left), style = IosText.body, fontWeight = FontWeight.Medium, color = secondary, modifier = Modifier.padding(bottom = 5.dp))
        }
        UsageBar(plan, window, nowMs, Modifier.padding(vertical = 2.dp))
        Text(reset, style = IosText.footnote, color = secondary)
    }
}
