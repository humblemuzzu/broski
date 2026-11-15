package com.muzammil.broski.design

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
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

/**
 * An agent's monogram in neutral tones, never its brand logo. Each agent also has its own shape,
 * so the two tell apart without reading the letters.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AgentMark(backend: BackendId, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val shape = when (backend) {
        BackendId.CLAUDE_CODE -> MaterialShapes.Cookie9Sided
        BackendId.PI -> MaterialShapes.Clover4Leaf
    }.toShape()
    val monogram = when (backend) {
        BackendId.CLAUDE_CODE -> R.string.agent_mark_claude_code
        BackendId.PI -> R.string.agent_mark_pi
    }
    Box(
        modifier = modifier
            .size(size)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest, shape)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = stringResource(monogram),
            style = MaterialTheme.typography.labelLarge,
            // Sized to the mark, not the font scale: the mark is decorative and its row reads the name.
            fontSize = with(LocalDensity.current) { (size * 0.34f).toSp() },
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}
