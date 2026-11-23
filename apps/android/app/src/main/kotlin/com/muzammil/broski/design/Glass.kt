package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable

/**
 * The control layer the iOS app draws in Liquid Glass (bars, floating buttons, the tab bar), as a
 * frosted surface: a light fill a step off the screen, a hairline edge and a soft shadow, so the
 * controls float over content the same way. Content (rows, bubbles) never takes it.
 */
@Composable
fun GlassSurface(
    shape: Shape,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .glassShadow(shape)
            .clip(shape)
            .background(Glass.fill, shape)
            .border(0.5.dp, Glass.edge, shape),
        contentAlignment = Alignment.Center,
    ) {
        CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) { content() }
    }
}

/** A round glass button with one symbol: close, back, the bar's actions. */
@Composable
fun GlassCircleButton(
    @DrawableRes icon: Int,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    side: Dp = GlassMetrics.control,
) {
    GlassSurface(
        shape = CircleShape,
        modifier = modifier
            .size(side)
            .clickable(role = Role.Button, onClickLabel = contentDescription, onClick = onClick),
    ) {
        Icon(painterResource(icon), contentDescription = contentDescription, modifier = Modifier.size(22.dp))
    }
}

/**
 * A capsule button as iOS's `.glassProminent` (ink fill, [prominent]) or `.glass` draws it: its label
 * in 15 sp semibold, [tint] colouring a glass button's label (red for Deny), [wide] filling the row.
 */
@Composable
fun GlassButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    prominent: Boolean = false,
    tint: Color? = null,
    enabled: Boolean = true,
    wide: Boolean = true,
    height: Dp = 48.dp,
) {
    val shape = CircleShape
    val ink = MaterialTheme.colorScheme.primary
    val label = when {
        prominent -> MaterialTheme.colorScheme.onPrimary
        tint != null -> tint
        else -> MaterialTheme.colorScheme.onSurface
    }
    Box(
        modifier
            .then(if (wide) Modifier.fillMaxWidth() else Modifier)
            .heightIn(min = height)
            .alpha(if (enabled) 1f else 0.4f)
            .then(if (prominent) Modifier else Modifier.glassShadow(shape))
            .clip(shape)
            .background(if (prominent) ink else Glass.fill, shape)
            .then(if (prominent) Modifier else Modifier.border(0.5.dp, Glass.edge, shape))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold), color = label, textAlign = TextAlign.Center)
    }
}

/** The glass's own colours, for a control that draws its own surface (the composer). */
object Glass {
    val fill: Color
        @Composable @ReadOnlyComposable
        get() = if (dark()) Color(0xFF1C1C1E).copy(alpha = 0.97f) else Color.White.copy(alpha = 0.98f)

    val edge: Color
        @Composable @ReadOnlyComposable
        get() = if (dark()) Color.White.copy(alpha = 0.10f) else Color.Black.copy(alpha = 0.06f)
}

/** The soft shadow glass floats on in light; dark glass floats on its edge alone. */
@Composable
fun Modifier.glassShadow(shape: Shape): Modifier =
    if (dark()) this else shadow(10.dp, shape, ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.10f))

@Composable
@ReadOnlyComposable
private fun dark(): Boolean = MaterialTheme.colorScheme.surface.luminance() < 0.5f

object GlassMetrics {
    /** A glass control's side: iOS's 44 pt touch target. */
    val control = 44.dp
}
