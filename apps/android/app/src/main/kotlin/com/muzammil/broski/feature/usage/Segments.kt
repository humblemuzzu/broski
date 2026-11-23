package com.muzammil.broski.feature.usage

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.perform

/**
 * A segmented picker as iOS draws one: a grey capsule track, the chosen segment on a raised pill that
 * slides to the next choice, small labels, a selection tick on each change. [compact] is its small size.
 */
@Composable
fun <T> Segments(
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val haptics = LocalHapticFeedback.current
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val track = Color(0xFF767680).copy(alpha = if (dark) 0.24f else 0.12f)
    val thumb = if (dark) Color(0xFF636366) else Color.White
    val style = if (compact) IosText.caption else IosText.footnote
    val index = options.indexOf(selected).coerceAtLeast(0)
    BoxWithConstraints(modifier.height(if (compact) 28.dp else 32.dp).background(track, CircleShape).padding(2.dp)) {
        val width = maxWidth / options.size
        val offset by animateDpAsState(width * index, MaterialTheme.motionScheme.fastSpatialSpec(), label = "segment")
        Box(
            Modifier
                .offset(x = offset)
                .width(width)
                .fillMaxHeight()
                .shadow(if (dark) 0.dp else 2.dp, CircleShape)
                .background(thumb, CircleShape),
        )
        Row(Modifier.fillMaxHeight()) {
            options.forEach { option ->
                val chosen = option == selected
                Box(
                    Modifier
                        .width(width)
                        .fillMaxHeight()
                        .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) {
                            if (!chosen) {
                                haptics.perform(Haptic.PickerStep)
                                onSelect(option)
                            }
                        }
                        .semantics { this.selected = chosen },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label(option),
                        style = style.copy(fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
