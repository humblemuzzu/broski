package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.muzammil.broski.design.BroskiTheme
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
    line: Int? = null,
) {
    val text = remember(lines) { lines.joinToString("\n") }
    val language = remember(path) { languageForPath(path) }
    val coloured = highlightedLines(text, language, CodeColors.current)
    val marked = BroskiTheme.semantic.highlight.copy(alpha = 0.14f)
    val numbered = remember(coloured, line, marked) {
        coloured.mapIndexed { index, text -> ViewerLine(text, (index + 1).toString(), background = marked.takeIf { index + 1 == line }) }
    }
    val state = rememberLazyListState(initialFirstVisibleItemIndex = ((line ?: 1) - CONTEXT_LINES).coerceAtLeast(0))
    CodeLines(numbered, MaterialTheme.typography.bodySmall.mono(), wrap, modifier, contentPadding, state = state)
}

/** Lines shown above the one a link opened the file at. */
private const val CONTEXT_LINES = 6
