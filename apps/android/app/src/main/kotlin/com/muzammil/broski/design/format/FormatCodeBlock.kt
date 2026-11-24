package com.muzammil.broski.design.format

import android.content.ClipData
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.MonoFamily
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.code.accent
import com.muzammil.broski.design.code.diffRows
import com.muzammil.broski.design.code.highlightedLines
import com.muzammil.broski.design.code.segmentedText
import com.muzammil.broski.design.mono
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import uniffi.broski_core.FormatCode
import uniffi.broski_core.languageLabel
import uniffi.broski_core.parseUnifiedDiff

@Composable
fun FormatCodeBlock(code: FormatCode, streaming: Boolean) {
    val kind = remember(code.language) { CodeKind.of(code.language) }
    var expanded by remember { mutableStateOf(false) }
    val diff = remember(code.text, kind, code.closed) {
        if (kind == CodeKind.Diff && code.closed) parseUnifiedDiff(code.text).files.firstOrNull() else null
    }
    val inset = 14.dp
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(FormatTokens.codeRadius),
        color = MaterialTheme.colorScheme.surfaceContainer,
        border = BorderStroke(0.5.dp, formatCardBorder),
    ) {
        Column {
            CodeHeader(code, kind, inset) { expanded = true }
            Box(Modifier.fillMaxWidth().height(0.5.dp).background(formatCardBorder))
            if (diff != null) InlineDiff(diff, inset) else CodeBody(code, kind, streaming, inset)
        }
    }
    if (expanded) CodeViewer(code.text, code.language, code.file ?: title(code, kind)) { expanded = false }
}

@Composable
private fun title(code: FormatCode, kind: CodeKind): String = when {
    kind == CodeKind.Mermaid -> stringResource(R.string.format_code_mermaid)
    else -> code.language?.let { languageLabel(it) } ?: stringResource(R.string.format_code_text)
}

@Composable
private fun CodeHeader(code: FormatCode, kind: CodeKind, inset: Dp, onExpand: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val lines = remember(code.text) { code.text.count { it == '\n' } + 1 }
    val reading = LocalReading.current
    val setReading = LocalSetReading.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(COPIED_MS)
            copied = false
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(start = inset, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title(code, kind), style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium), color = muted)
        code.file?.let {
            Text(it, style = MaterialTheme.typography.labelSmall.mono(), color = muted, maxLines = 1, overflow = TextOverflow.StartEllipsis, modifier = Modifier.weight(1f, fill = false))
        }
        if (lines > FormatTokens.CODE_COUNT_LINES) {
            Text(pluralStringResource(R.plurals.format_code_lines, lines, lines), style = MaterialTheme.typography.labelSmall, color = muted.copy(alpha = 0.7f))
        }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
            if (!code.prose && kind != CodeKind.Diff) {
                HeaderButton(R.drawable.ic_wrap_text, if (reading.wrapsCode) R.string.format_code_scroll else R.string.format_code_wrap, tint = if (reading.wrapsCode) formatLink else muted) {
                    setReading(reading.copy(wrapsCode = !reading.wrapsCode))
                }
            }
            HeaderButton(
                if (copied) R.drawable.ic_check else R.drawable.ic_content_copy,
                R.string.format_copy_code,
                tint = if (copied) BroskiTheme.semantic.done else muted,
            ) {
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(code.language ?: "code", copyText(code.text, kind)))) }
                haptics.perform(Haptic.Success)
                copied = true
            }
            HeaderButton(R.drawable.ic_open_in_full, R.string.format_expand, tint = muted, onClick = onExpand)
        }
    }
}

@Composable
private fun HeaderButton(icon: Int, label: Int, tint: Color, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(36.dp)) {
        Icon(painterResource(icon), contentDescription = stringResource(label), modifier = Modifier.size(16.dp), tint = tint)
    }
}

private const val COPIED_MS = 1_500L

@Composable
private fun CodeBody(code: FormatCode, kind: CodeKind, streaming: Boolean, inset: Dp) {
    val colors = CodeColors.current
    val completed = remember(code.text, code.closed, streaming) {
        if (code.closed || !streaming) code.text else code.text.substringBeforeLast('\n', "")
    }
    val coloured = highlightedLines(completed, code.language, colors)
    val all = remember(code.text) { code.text.split('\n') }
    var unfolded by rememberSaveable { mutableStateOf(false) }
    val folds = all.size > FormatTokens.CODE_FOLD_LINES && !unfolded
    val shown = if (folds) FormatTokens.CODE_FOLD_LINES else all.size
    val dim = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.55f)
    val text = remember(coloured, all, shown, kind, dim) {
        buildAnnotatedString {
            for (index in 0 until shown) {
                if (index > 0) append('\n')
                val line = coloured.getOrNull(index)?.takeIf { it.text == all[index] } ?: AnnotatedString(all[index])
                appendLine(line, kind == CodeKind.Shell, dim)
            }
        }
    }
    val wraps = code.prose || LocalReading.current.wrapsCode || LocalDensity.current.fontScale >= LARGE_FONT_SCALE
    val style = MaterialTheme.typography.bodySmall.copy(fontFamily = MonoFamily, fontSize = FormatTokens.codeSize, lineHeight = FormatTokens.codeSize * 1.48f)
    Column {
        val padding = Modifier.padding(start = inset, end = inset, top = 10.dp, bottom = if (folds) 4.dp else 12.dp)
        SelectionContainer {
            if (wraps) {
                Text(text, style = style, color = colors.plain, modifier = padding.fillMaxWidth().fadeFoot(folds))
            } else {
                val scroll = rememberScrollState()
                Row(
                    Modifier
                        .fadeEnd(scroll.maxValue > 0 && scroll.value < scroll.maxValue, 22.dp)
                        .horizontalScroll(scroll)
                        .then(padding)
                        .fadeFoot(folds),
                ) {
                    Text(text, style = style, color = colors.plain, softWrap = false)
                }
            }
        }
        if (folds) {
            TextButton(onClick = { unfolded = true }, modifier = Modifier.fillMaxWidth()) {
                Text(pluralStringResource(R.plurals.format_code_more_lines, all.size - shown, all.size - shown), color = formatLink, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

private fun AnnotatedString.Builder.appendLine(line: AnnotatedString, shell: Boolean, dim: Color) {
    if (shell && line.text.startsWith("$ ")) {
        withStyle(SpanStyle(color = dim)) { append("$ ") }
        append(line.subSequence(2, line.length))
    } else {
        append(line)
    }
}

private fun copyText(text: String, kind: CodeKind): String =
    if (kind != CodeKind.Shell) text else text.split('\n').joinToString("\n") { it.removePrefix("$ ") }

@Composable
private fun InlineDiff(file: uniffi.broski_core.DiffFile, inset: Dp) {
    val colors = CodeColors.current
    val rows = remember(file) { diffRows(file) }
    val style = MaterialTheme.typography.bodySmall.mono()
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).horizontalScroll(rememberScrollState())) {
        rows.forEach { row ->
            val accent = row.kind.accent(colors)
            Row(Modifier.background(accent?.let(colors::lineTint) ?: Color.Transparent).padding(horizontal = inset)) {
                Text(row.gutter, style = style, color = colors.gutter, softWrap = false)
                Text(segmentedText(row.text, row.segments, colors, accent?.let(colors::wordTint)), style = style, softWrap = false, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

private const val LARGE_FONT_SCALE = 1.7f

enum class CodeKind {
    Code,
    Diff,
    Shell,
    Mermaid,
    ;

    companion object {
        fun of(language: String?): CodeKind = when (language?.lowercase()) {
            "diff", "patch" -> Diff
            "sh", "bash", "zsh", "shell", "console", "shellsession", "terminal" -> Shell
            "mermaid" -> Mermaid
            else -> Code
        }
    }
}
