package com.muzammil.broski.design.format

import android.content.ClipData
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.MonoFamily
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.code.highlightedLines
import com.muzammil.broski.design.mono
import kotlinx.coroutines.launch
import uniffi.broski_core.FormatBlock
import uniffi.broski_core.FormatContent
import uniffi.broski_core.FormatSpan

/** One block of formatted text: a paragraph, or a fenced block of code. */
@Composable
fun FormatBlockView(block: FormatBlock, modifier: Modifier = Modifier, role: FormatRole = FormatRole.Page) {
    when (val content = block.content) {
        is FormatContent.Paragraph -> {
            val codeFill = MaterialTheme.colorScheme.surfaceContainerHighest
            val text = remember(content.spans, codeFill) { formatSpans(content.spans, codeFill) }
            SelectionContainer(modifier) { Text(text, style = role.textStyle(), color = role.color()) }
        }
        is FormatContent.Code -> FormatCodeBlock(content.text, content.language, modifier)
    }
}

/** The spans as one string: code in the monospace on a quiet fill. */
fun formatSpans(spans: List<FormatSpan>, codeFill: Color): AnnotatedString = buildAnnotatedString {
    val code = SpanStyle(fontFamily = MonoFamily, background = codeFill)
    spans.forEach { span -> if (span.code) withStyle(code) { append(span.text) } else append(span.text) }
}

/** A fenced block: its language over it with a copy button, the lines coloured by the core and scrolling sideways. */
@Composable
private fun FormatCodeBlock(text: String, language: String?, modifier: Modifier) {
    val colors = CodeColors.current
    val lines = highlightedLines(text, language, colors)
    val joined = remember(lines) {
        buildAnnotatedString {
            lines.forEachIndexed { index, line ->
                if (index > 0) append('\n')
                append(line)
            }
        }
    }
    Surface(modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column {
            CodeHeader(text, language)
            SelectionContainer {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
                    Text(joined, style = MaterialTheme.typography.bodySmall.mono(), color = colors.plain, softWrap = false)
                }
            }
        }
    }
}

@Composable
private fun CodeHeader(text: String, language: String?) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(language.orEmpty(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        IconButton(onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(language ?: "code", text))) } }) {
            Icon(painterResource(R.drawable.ic_content_copy), contentDescription = stringResource(R.string.format_copy_code), modifier = Modifier.size(18.dp))
        }
    }
}
