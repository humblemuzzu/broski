package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R

/**
 * The composer's measures. Its row is 36 dp controls 8 dp in from the edge, so the collapsed composer
 * is 52 dp high and its 26 dp corners make it a capsule.
 */
object ComposerMetrics {
    val CONTROL = 36.dp
    val INSET = 8.dp
    val RADIUS = 26.dp
    val GLYPH = 17.dp
}

/** The round controls' and the model pill's fill: a soft step up from the composer's surface. */
val composerFill: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.09f)

/** A round control of the composer's row. */
@Composable
fun ComposerCircle(
    icon: Int,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    container: Color = composerFill,
    content: Color = MaterialTheme.colorScheme.onSurface,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .size(ComposerMetrics.CONTROL)
            .clip(CircleShape)
            .background(container)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = description, indication = ripple(), interactionSource = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), contentDescription = description, tint = content, modifier = Modifier.size(ComposerMetrics.GLYPH))
    }
}

/** ✕ in place of `+` while dictating: throws the recording away. */
@Composable
fun CancelDictation(onCancel: () -> Unit) {
    ComposerCircle(R.drawable.ic_close, stringResource(R.string.dictation_cancel), onCancel)
}
