package com.muzammil.broski.feature.chat.composer

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

/** An active `@file` mention ending at [end]: [start] is the index of `@`, [query] follows it. */
data class FileMention(val start: Int, val end: Int, val query: String)

/** Result of replacing an active `@file` mention: updated draft text and new cursor offset. */
data class MentionReplacement(val text: String, val cursor: Int)

private val MENTION_DELIMITERS = setOf('(', '[', '{', '"', '\'')

/**
 * Finds the active `@query` ending at [cursor] (or end of [text] when null), or `null` when not
 * mentioning a file or when a `/` slash command is active. Rejects emails (`user@example.com`).
 */
fun activeFileMention(text: String, commandActive: Boolean, cursor: Int? = null): FileMention? {
    if (commandActive || text.isEmpty()) return null
    val end = (cursor ?: text.length).coerceIn(0, text.length)
    if (end == 0) return null
    var index = end - 1
    while (index >= 0) {
        val ch = text[index]
        if (ch.isWhitespace()) return null
        if (ch == '@') {
            if (index > 0) {
                val before = text[index - 1]
                if (!before.isWhitespace() && before !in MENTION_DELIMITERS) return null
            }
            return FileMention(start = index, end = end, query = text.substring(index + 1, end))
        }
        index -= 1
    }
    return null
}

/** Replaces `[mention.start, mention.end)` with `@path` (quoted if it has whitespace, trailing space if needed). */
fun replaceFileMention(text: String, mention: FileMention, path: String): MentionReplacement {
    val base = if (path.any(Char::isWhitespace)) "@\"$path\"" else "@$path"
    val needsSpace = mention.end >= text.length || !text[mention.end].isWhitespace()
    val inserted = if (needsSpace) "$base " else base
    val next = text.substring(0, mention.start) + inserted + text.substring(mention.end)
    return MentionReplacement(text = next, cursor = mention.start + inserted.length)
}

/** Per-composer LRU cache with a 30 s TTL so newly created files appear without stalling backspaces. */
internal class MentionCache(
    private val capacity: Int = 32,
    private val ttlMs: Long = CACHE_TTL_MS,
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private data class Entry(val paths: List<String>, val storedAtMs: Long)

    private val entries = object : LinkedHashMap<String, Entry>(capacity, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>): Boolean = size > capacity
    }

    fun get(query: String): List<String>? {
        val entry = entries[query] ?: return null
        if (nowMs() - entry.storedAtMs > ttlMs) {
            entries.remove(query)
            return null
        }
        return entry.paths
    }

    fun put(query: String, paths: List<String>) {
        entries[query] = Entry(paths, nowMs())
    }
}

/**
 * Debounced, cached file search for `@file` mentions over the composer; cancels in-flight queries
 * as the person types. [search] returns `null` on transport failure so errors are never cached.
 */
@Composable
fun FileMentionPopup(
    text: String,
    cursor: Int?,
    commandActive: Boolean,
    root: String?,
    search: suspend (String) -> List<String>?,
    onPick: (FileMention, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val mention = activeFileMention(text, commandActive, cursor)
    val cache = remember(root) { MentionCache() }
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
        if (found != null) {
            cache.put(mention.query, found)
            results = found
        } else {
            results = emptyList()
        }
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
private const val CACHE_TTL_MS = 30_000L
