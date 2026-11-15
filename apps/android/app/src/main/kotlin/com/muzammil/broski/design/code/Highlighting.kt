package com.muzammil.broski.design.code

import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.broski_core.CodeLine
import uniffi.broski_core.TokenKind
import uniffi.broski_core.highlight

/**
 * The core's colouring of code, kept by text and language so a block scrolled back into view, or a
 * message whose later blocks stream, is never coloured again.
 */
private object Highlights {
    private const val MAX_LINES = 20_000

    private data class Key(val text: String, val language: String?)

    private val cache = object : LruCache<Key, List<CodeLine>>(MAX_LINES) {
        override fun sizeOf(key: Key, value: List<CodeLine>) = value.size.coerceAtLeast(1)
    }

    fun cached(text: String, language: String?): List<CodeLine>? = cache.get(Key(text, language))

    fun compute(text: String, language: String?): List<CodeLine> =
        highlight(text, language).also { cache.put(Key(text, language), it) }
}

/**
 * [text]'s lines coloured by the core's `highlight` for [language] (a fence label, or what
 * `languageForPath` named). Colouring runs off the main thread; until it lands, a line shows plain,
 * or as it was coloured before the text grew, so a streaming block never flickers.
 */
@Composable
fun highlightedLines(text: String, language: String?, colors: CodeColors): List<AnnotatedString> {
    var latest by remember { mutableStateOf(Highlights.cached(text, language)) }
    LaunchedEffect(text, language) {
        latest = Highlights.cached(text, language) ?: withContext(Dispatchers.Default) { Highlights.compute(text, language) }
    }
    return remember(text, latest, colors) { colour(text.split('\n'), latest.orEmpty(), colors) }
}

/** Each line coloured by the line at its index in [coloured] when that one spells the same text. */
internal fun colour(lines: List<String>, coloured: List<CodeLine>, colors: CodeColors): List<AnnotatedString> =
    lines.mapIndexed { index, line ->
        val spans = coloured.getOrNull(index)?.spans
        if (spans == null || spans.joinToString("") { it.text } != line) {
            AnnotatedString(line)
        } else {
            buildAnnotatedString {
                spans.forEach { span ->
                    if (span.kind == TokenKind.PLAIN) append(span.text) else withStyle(SpanStyle(color = colors.of(span.kind))) { append(span.text) }
                }
            }
        }
    }
