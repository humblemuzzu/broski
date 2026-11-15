package com.muzammil.broski.design.code

import android.content.ClipData
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.mono
import kotlinx.coroutines.launch

/**
 * A block of code inside a page of text: its language over it with a copy button, the lines
 * coloured by the core and scrolling sideways rather than wrapping, numbered when [lineNumbers].
 */
@Composable
fun CodeBlock(text: String, language: String?, modifier: Modifier = Modifier, lineNumbers: Boolean = false) {
    val colors = CodeColors.current
    val lines = highlightedLines(text, language, colors)
    val joined = remember(lines) { joinLines(lines) }
    val style = MaterialTheme.typography.bodySmall.mono()
    Surface(modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column {
            CodeBlockHeader(text, language)
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
                if (lineNumbers) {
                    DisableSelection {
                        Text(
                            (1..lines.size).joinToString("\n"),
                            style = style,
                            color = colors.gutter,
                            textAlign = TextAlign.End,
                            modifier = Modifier.padding(end = 12.dp).clearAndSetSemantics {},
                        )
                    }
                }
                Text(joined, style = style, color = colors.plain, softWrap = false)
            }
        }
    }
}

@Composable
private fun CodeBlockHeader(text: String, language: String?) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            language.orEmpty(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        IconButton(onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(language ?: "code", text))) } }) {
            Icon(
                painterResource(R.drawable.ic_content_copy),
                contentDescription = stringResource(R.string.code_copy),
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

private fun joinLines(lines: List<AnnotatedString>): AnnotatedString = buildAnnotatedString {
    lines.forEachIndexed { index, line ->
        if (index > 0) append('\n')
        append(line)
    }
}
