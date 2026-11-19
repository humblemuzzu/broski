package com.muzammil.broski.feature.chat.composer

import android.util.LruCache
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.mono
import kotlinx.coroutines.delay

/** An active `@file` mention at the end of a draft: [start] is the index of `@`, [query] follows it. */
data class FileMention(val start: Int, val query: String)

private val MENTION_DELIMITERS = setOf('(', '[', '{', '"', '\'')

/**
 * Finds the active trailing `@query` in [text], or `null` when not mentioning a file (or when a
 * `/` slash command is active). Rejects email look-alikes such as `user@example.com`.
 */
fun activeFileMention(text: String, commandActive: Boolean): FileMention? {
    if (commandActive || text.isEmpty()) return null
    var index = text.length - 1
    while (index >= 0) {
        val ch = text[index]
        if (ch.isWhitespace()) return null
        if (ch == '@') {
            if (index > 0) {
                val before = text[index - 1]
                if (!before.isWhitespace() && before !in MENTION_DELIMITERS) return null
            }
            return FileMention(start = index, query = text.substring(index + 1))
        }
        index -= 1
    }
    return null
}

/** Replaces the active `@query` with `@path ` (quoted if [path] contains whitespace). */
fun replaceFileMention(text: String, mention: FileMention, path: String): String {
    val formatted = if (path.any(Char::isWhitespace)) "@\"$path\" " else "@$path "
    return text.substring(0, mention.start) + formatted
}

/**
 * Debounced, cached file search for `@file` mentions over the composer; cancels in-flight queries
 * as the person types and serves backspaced queries from a small per-composer LRU cache.
 */
@Composable
fun FileMentionPopup(
    text: String,
    commandActive: Boolean,
    root: String?,
    search: suspend (String) -> List<String>,
    onPick: (FileMention, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val mention = activeFileMention(text, commandActive)
    val cache = remember(root) { LruCache<String, List<String>>(32) }
    var results by remember(root) { mutableStateOf<List<String>>(emptyList()) }

    LaunchedEffect(root, mention?.query) {
        if (root == null || mention == null) {
            results = emptyList()
            return@LaunchedEffect
        }
        val cached = cache.get(mention.query)
        if (cached != null) {
            results = cached
            return@LaunchedEffect
        }
        delay(SEARCH_DEBOUNCE_MS)
        val found = search(mention.query)
        cache.put(mention.query, found)
        results = found
    }

    if (mention != null && results.isNotEmpty()) {
        FileMentionList(results, onPick = { path -> onPick(mention, path) }, modifier = modifier)
    }
}

@Composable
private fun FileMentionList(paths: List<String>, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 2.dp,
    ) {
        LazyColumn(Modifier.heightIn(max = 220.dp).padding(vertical = 6.dp)) {
            items(paths, key = { it }) { path ->
                val isFolder = path.endsWith("/")
                val trimmed = if (isFolder) path.dropLast(1) else path
                val slash = trimmed.lastIndexOf('/')
                val name = if (slash >= 0) trimmed.substring(slash + 1) else trimmed
                val parent = if (slash > 0) trimmed.substring(0, slash) else null
                Row(
                    modifier = Modifier.fillMaxWidth().clickable { onPick(path) }.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        painterResource(if (isFolder) R.drawable.ic_folder else R.drawable.ic_draft),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                    Column {
                        Text(
                            if (isFolder) "$name/" else name,
                            style = MaterialTheme.typography.bodyMedium.mono(),
                            maxLines = 1,
                            overflow = TextOverflow.MiddleEllipsis,
                        )
                        if (parent != null) {
                            Text(
                                parent,
                                style = MaterialTheme.typography.bodySmall.mono(),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.StartEllipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

private const val SEARCH_DEBOUNCE_MS = 120L
