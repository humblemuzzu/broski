package com.muzammil.broski.feature.chat.composer

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.roundToInt

private val SPACING = 8.dp
private val FIELD_INSET = 6.dp
private val FIELD_TOP = 6.dp
private val FIELD_GAP = 10.dp
private val FIELD_LEAD = 10.dp

/**
 * The composer's field and its row, from one set of children so the field keeps its focus as the
 * composer changes shape. At [progress] 0, one row: [leading], the field, [trailing], the pickers
 * sitting where the field is (the caller fades them). At 1, the field spans the top and the row beneath
 * holds [leading], the pickers and [trailing]. Between, every position and the height are interpolated,
 * so the shape morphs; the row stays on the bottom edge, so opening grows the composer upward.
 */
@Composable
fun ComposerLayout(
    progress: Float,
    leading: @Composable () -> Unit,
    field: @Composable () -> Unit,
    pickers: @Composable () -> Unit,
    trailing: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    Layout(contents = listOf(leading, field, pickers, trailing), modifier = modifier) { (leadings, fields, pickerss, trailings), constraints ->
        val width = constraints.maxWidth
        val loose = Constraints(maxWidth = width)
        val spacing = SPACING.roundToPx()
        val inset = FIELD_INSET.roundToPx()
        val lead = leadings.firstOrNull()?.measure(loose)
        val trail = trailings.firstOrNull()?.measure(loose)
        val leadWidth = lead?.width ?: 0
        val trailWidth = trail?.width ?: 0
        val middleX = if (leadWidth > 0) leadWidth + spacing else 0
        val middleWidth = max(0, width - middleX - trailWidth - if (trailWidth > 0) spacing else 0)
        val pickersPlaced = pickerss.firstOrNull()?.measure(Constraints(maxWidth = middleWidth))

        val collapsedFieldX = if (leadWidth > 0) leadWidth + FIELD_LEAD.roundToPx() else inset
        val collapsedFieldWidth = width - collapsedFieldX - (if (trailWidth > 0) trailWidth + spacing else inset)
        val fieldWidth = lerp(collapsedFieldWidth, width - 2 * inset, progress).coerceAtLeast(0)
        val fieldPlaced = fields.first().measure(Constraints(minWidth = fieldWidth, maxWidth = fieldWidth))

        val row = maxOf(ComposerMetrics.CONTROL.roundToPx(), lead?.height ?: 0, trail?.height ?: 0, pickersPlaced?.height ?: 0)
        val collapsed = max(row, fieldPlaced.height)
        val expanded = FIELD_TOP.roundToPx() + fieldPlaced.height + FIELD_GAP.roundToPx() + row
        val height = lerp(collapsed, expanded, progress)
        val rowHeight = lerp(collapsed, row, progress)
        val rowMid = height - rowHeight / 2

        layout(width, height) {
            lead?.place(0, rowMid - lead.height / 2)
            trail?.place(width - trailWidth, rowMid - trail.height / 2)
            pickersPlaced?.place(middleX, rowMid - pickersPlaced.height / 2)
            val fromBottomCollapsed = collapsed / 2 + fieldPlaced.height / 2
            val fromBottomExpanded = expanded - FIELD_TOP.roundToPx()
            fieldPlaced.place(
                lerp(collapsedFieldX, inset, progress),
                height - lerp(fromBottomCollapsed, fromBottomExpanded, progress),
            )
        }
    }
}

private fun lerp(from: Int, to: Int, fraction: Float): Int = (from + (to - from) * fraction).roundToInt()
