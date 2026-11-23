package com.muzammil.broski.feature.inbox

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform

/**
 * The plain white the inbox says its own words in: the filter in the bar, the section headers and
 * their counts, Mark All Read. Readable at a glance, a step below the rows' titles.
 */
val inboxTone: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f)

val inboxToneStyle: TextStyle
    @Composable @ReadOnlyComposable
    get() = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, color = inboxTone)

private val HeaderPadding = Modifier.padding(start = Grouped.margin + 16.dp, end = Grouped.margin + 16.dp, top = 20.dp, bottom = 8.dp)

/** A section's name and how many it holds; Done also offers Mark All Read. */
@Composable
fun InboxSectionHeader(title: String, count: Int, modifier: Modifier = Modifier, onMarkAllRead: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth().then(HeaderPadding), verticalAlignment = Alignment.CenterVertically) {
        SectionLabel(title, count, Modifier.semantics { heading() })
        if (onMarkAllRead != null) {
            Spacer(Modifier.weight(1f))
            Text(
                stringResource(R.string.inbox_mark_all_read),
                style = inboxToneStyle,
                modifier = Modifier.clickable(role = Role.Button, onClick = onMarkAllRead),
            )
        }
    }
}

/** Idle's header, which folds the idle sessions away and opens them again. */
@Composable
fun IdleHeader(count: Int, open: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    val turn by animateFloatAsState(if (open) 90f else 0f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "idle")
    val label = stringResource(R.string.inbox_idle_header, count)
    val shown = stringResource(if (open) R.string.inbox_idle_shown else R.string.inbox_idle_folded)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable {
                haptics.perform(Haptic.PickerStep)
                onToggle()
            }
            .clearAndSetSemantics {
                contentDescription = label
                stateDescription = shown
                heading()
                onClick { onToggle(); true }
            }
            .then(HeaderPadding)
            .heightIn(min = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionLabel(stringResource(R.string.inbox_section_idle), count)
        Spacer(Modifier.weight(1f))
        Icon(
            painterResource(R.drawable.ic_chevron_right),
            contentDescription = null,
            tint = inboxTone,
            modifier = Modifier.size(18.dp).rotate(turn),
        )
    }
}

@Composable
private fun SectionLabel(title: String, count: Int, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = inboxToneStyle)
        Text("$count", style = inboxToneStyle.copy(fontFeatureSettings = "tnum"))
    }
}
