package com.muzammil.broski.design

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * A switch as iOS 26 draws one: a 64 by 28 capsule, green when on and grey when off, a white pill of
 * a thumb that springs across, and the system's tick on each flip.
 */
@Composable
fun IosSwitch(checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val haptics = LocalHapticFeedback.current
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val on = if (dark) Color(0xFF30D158) else Color(0xFF34C759)
    val off = Color(0xFF787880).copy(alpha = if (dark) 0.48f else 0.4f)
    val track by animateColorAsState(if (checked) on else off, label = "switch track")
    val thumb by animateDpAsState(
        if (checked) SWITCH_WIDTH - THUMB_WIDTH - 2.dp else 2.dp,
        spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow),
        label = "switch thumb",
    )
    Box(
        Modifier
            .size(SWITCH_WIDTH, 28.dp)
            .alpha(if (enabled) 1f else 0.5f)
            .clip(CircleShape)
            .background(track)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) {
                haptics.perform(if (it) Haptic.Expand else Haptic.Collapse)
                onChange(it)
            },
    ) {
        Box(
            Modifier
                .offset(x = thumb, y = 2.dp)
                .size(THUMB_WIDTH, 24.dp)
                .shadow(1.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.2f))
                .background(Color.White, CircleShape),
        )
    }
}

private val SWITCH_WIDTH = 64.dp
private val THUMB_WIDTH = 38.dp
