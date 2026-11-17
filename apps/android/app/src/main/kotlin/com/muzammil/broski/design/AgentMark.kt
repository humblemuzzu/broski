package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import uniffi.broski_contract.BackendId

@get:StringRes
val BackendId.displayName: Int
    get() = when (this) {
        BackendId.CLAUDE_CODE -> R.string.agent_claude_code
        BackendId.PI -> R.string.agent_pi
    }

/** Each agent's own logo, white on its maker's colour, as the iOS app and its Live Activity draw it. */
private class AgentBrand(@param:DrawableRes val glyph: Int, val glyphShare: Float, val top: Color, val bottom: Color)

private val BackendId.brand: AgentBrand
    get() = when (this) {
        // Claude's spark is round and thin, Pi's blocks square and heavy: the spark takes more of the tile.
        BackendId.CLAUDE_CODE -> AgentBrand(R.drawable.ic_agent_claude, 0.66f, Color(0xFFE38B6C), Color(0xFFC66242))
        BackendId.PI -> AgentBrand(R.drawable.ic_agent_pi, 0.46f, Color(0xFF333655), Color(0xFF16192A))
    }

/** An agent's logo in its tile. Decorative: the row it sits in reads the agent's name. */
@Composable
fun AgentMark(backend: BackendId, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val brand = backend.brand
    val shape = RoundedCornerShape(28)
    Box(
        modifier = modifier
            .size(size)
            .background(Brush.verticalGradient(listOf(brand.top, brand.bottom)), shape)
            .border(0.5.dp, Color.White.copy(alpha = 0.14f), shape)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painterResource(brand.glyph),
            contentDescription = null,
            modifier = Modifier.size(size * brand.glyphShare),
        )
    }
}
