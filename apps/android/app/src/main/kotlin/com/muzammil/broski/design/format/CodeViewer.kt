package com.muzammil.broski.design.format

import android.content.ClipData
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.muzammil.broski.R
import com.muzammil.broski.design.MonoFamily
import com.muzammil.broski.design.code.CodeColors
import com.muzammil.broski.design.code.CodeLines
import com.muzammil.broski.design.code.ViewerLine
import com.muzammil.broski.design.code.highlightedLines
import kotlinx.coroutines.launch

/** A code block opened whole: numbered lines, coloured, drawn as they scroll into view; Wrap, Copy, and a pinch to resize. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodeViewer(code: String, language: String?, title: String, onDone: () -> Unit) {
    var wrap by remember { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(1f) }
    val transform = rememberTransformableState { _: Offset, change: Float, _: Offset, _: Float -> zoom = (zoom * change).coerceIn(MIN_ZOOM, MAX_ZOOM) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val coloured = highlightedLines(code, language, CodeColors.current)
    val lines = remember(coloured) { coloured.mapIndexed { index, line -> ViewerLine(line, (index + 1).toString()) } }
    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(title, maxLines = 1, overflow = TextOverflow.StartEllipsis) },
                    navigationIcon = { TextButton(onClick = onDone) { Text(stringResource(R.string.format_done)) } },
                    actions = {
                        IconButton(onClick = { wrap = !wrap }) {
                            Icon(painterResource(R.drawable.ic_wrap_text), stringResource(if (wrap) R.string.format_code_scroll else R.string.format_code_wrap))
                        }
                        IconButton(onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(title, code))) } }) {
                            Icon(painterResource(R.drawable.ic_content_copy), stringResource(R.string.format_copy_code))
                        }
                    },
                )
            },
        ) { padding ->
            val style = MaterialTheme.typography.bodySmall.copy(fontFamily = MonoFamily, fontSize = FormatTokens.codeSize * zoom, lineHeight = FormatTokens.codeSize * zoom * 1.45f)
            CodeLines(lines, style, wrap, Modifier.padding(padding).fillMaxSize().transformable(transform))
        }
    }
}

private const val MIN_ZOOM = 0.6f
private const val MAX_ZOOM = 2.4f
