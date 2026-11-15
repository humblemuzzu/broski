package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.code.CodeLines
import com.muzammil.broski.design.code.ViewerLine
import com.muzammil.broski.design.code.highlightedLines
import com.muzammil.broski.design.mono
import uniffi.broski_core.languageForPath

/** A text file as the viewer shows it: numbered monospaced lines, coloured by the core for the file's language. */
@Composable
fun FileText(
    lines: List<String>,
    path: String,
    wrap: Boolean,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(),
) {
    val text = remember(lines) { lines.joinToString("\n") }
    val language = remember(path) { languageForPath(path) }
    val coloured = highlightedLines(text, language, CodeColors.current)
    val numbered = remember(coloured) { coloured.mapIndexed { index, line -> ViewerLine(line, (index + 1).toString()) } }
    CodeLines(numbered, MaterialTheme.typography.bodySmall.mono(), wrap, modifier, contentPadding)
}
