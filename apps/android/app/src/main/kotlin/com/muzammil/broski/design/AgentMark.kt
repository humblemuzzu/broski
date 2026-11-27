package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import uniffi.broski_contract.BackendIconHint

/** Each agent's own logo, white on its maker's colour, as the iOS app and its Live Activity draw it. */
private class AgentBrand(@param:DrawableRes val glyph: Int, val glyphShare: Float, val top: Color, val bottom: Color)

private val Agent.brand: AgentBrand?
    get() = when (icon) {
        // Claude's spark is round and thin, Pi's blocks square and heavy, Antigravity's arch wide and solid:
        // each takes the share of the tile that makes the three weigh the same.
        BackendIconHint.CLAUDE -> AgentBrand(R.drawable.ic_agent_claude, 0.66f, Color(0xFFE38B6C), Color(0xFFC66242))
        BackendIconHint.PI -> AgentBrand(R.drawable.ic_agent_pi, 0.46f, Color(0xFF333655), Color(0xFF16192A))
        BackendIconHint.ANTIGRAVITY -> AgentBrand(R.drawable.ic_agent_antigravity, 0.58f, Color(0xFF4285F4), Color(0xFF1967D2))
        else -> null
    }

private val TileShape = RoundedCornerShape(28)

/** An agent's logo in its tile, or its initials on its accent for an agent with no logo here. Decorative: the row it sits in reads the agent's name. */
@Composable
fun AgentMark(agent: Agent, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val brand = agent.brand
    val tile = modifier.size(size).clearAndSetSemantics {}
    if (brand == null) {
        Monogram(agent, tile, size)
        return
    }
    Box(
        modifier = tile
            .background(Brush.verticalGradient(listOf(brand.top, brand.bottom)), TileShape)
            .border(0.5.dp, Color.White.copy(alpha = 0.14f), TileShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(brand.glyph),
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(size * brand.glyphShare),
        )
    }
}

@Composable
private fun Monogram(agent: Agent, modifier: Modifier, size: Dp) {
    val accent = accentColor(agent.accentHex)
    val background = accent?.let { Brush.verticalGradient(listOf(lerp(it, Color.White, 0.18f), it)) }
        ?: SolidColor(MaterialTheme.colorScheme.secondaryContainer)
    val ink = when {
        accent == null -> MaterialTheme.colorScheme.onSecondaryContainer
        accent.luminance() > 0.5f -> Color.Black.copy(alpha = 0.87f)
        else -> Color.White
    }
    val letters = monogram(agent)
    // In dp, not sp: the tile is a fixed size, so its letters and their line must not grow with the font scale.
    val letterSize = with(LocalDensity.current) { (size * if (letters.length > 1) 0.36f else 0.46f).toSp() }
    Box(
        modifier = modifier
            .background(background, TileShape)
            .border(0.5.dp, ink.copy(alpha = 0.14f), TileShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            letters,
            color = ink,
            fontSize = letterSize,
            lineHeight = letterSize,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            softWrap = false,
        )
    }
}

/** The first letters of the agent's first two words ("Gemini CLI" as "GC", "Codex" as "C"). */
internal fun monogram(agent: Agent): String {
    val words = agent.name.split(' ', '-', '_').mapNotNull { word -> word.firstOrNull(Char::isLetterOrDigit) }
    return words.take(2).joinToString("").uppercase().ifEmpty { agent.id.take(1).uppercase() }
}

/** A descriptor's `#RRGGBB`, or null for one that is absent or not that shape. */
internal fun accentColor(hex: String?): Color? {
    if (hex == null || !ACCENT.matches(hex)) return null
    return Color(0xFF000000 or hex.substring(1).toLong(16))
}

private val ACCENT = Regex("#[0-9a-fA-F]{6}")
