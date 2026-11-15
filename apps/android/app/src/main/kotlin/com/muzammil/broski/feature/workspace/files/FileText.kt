package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.muzammil.broski.design.CodeLine
import com.muzammil.broski.design.CodeLines
import com.muzammil.broski.design.mono

/**
 * A text file as the viewer shows it: numbered monospaced lines, no colouring. The one place file
 * text is drawn, so syntax colouring from the shared core lands here alone.
 */
@Composable
fun FileText(
    lines: List<String>,
    wrap: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val numbered = remember(lines) { lines.mapIndexed { index, line -> CodeLine(line, (index + 1).toString()) } }
    CodeLines(numbered, MaterialTheme.typography.bodySmall.mono(), wrap, modifier, contentPadding)
}
