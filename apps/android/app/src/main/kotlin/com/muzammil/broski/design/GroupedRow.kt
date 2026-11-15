package com.muzammil.broski.design

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.SegmentedListItem
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * One row of a group of rows on the screen's surface (as the inbox draws its sections): row
 * [index] of [count] takes its place in the group's rounded outline.
 */
@Composable
fun GroupedRow(
    index: Int,
    count: Int,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    supporting: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    headline: @Composable () -> Unit,
) {
    val shapes = ListItemDefaults.segmentedShapes(index, count)
    val placed = modifier.padding(horizontal = 16.dp).padding(bottom = ListItemDefaults.SegmentedGap)
    if (onClick != null) {
        SegmentedListItem(
            onClick = onClick,
            onLongClick = onLongClick,
            shapes = shapes,
            modifier = placed,
            leadingContent = leading,
            trailingContent = trailing,
            supportingContent = supporting,
            colors = groupedListItemColors(),
            content = headline,
        )
    } else {
        SegmentedListItem(
            shapes = shapes,
            modifier = placed,
            leadingContent = leading,
            trailingContent = trailing,
            supportingContent = supporting,
            colors = groupedListItemColors(),
            content = headline,
        )
    }
}
