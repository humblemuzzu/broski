package com.muzammil.broski.design.format

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import uniffi.broski_core.FormatBlock
import uniffi.broski_core.formatMarkdown

/**
 * Where agent-authored text is drawn, which sets its size and emphasis: [Page] for the answer the
 * person reads (the transcript, a plan, a report opened whole), [Quiet] for what sits under a row
 * (thinking, a subagent's or an activity's text).
 */
enum class FormatRole {
    Page,
    Quiet,
    ;

    val blockSpacing: Dp
        get() = if (this == Page) 12.dp else 8.dp

    @Composable
    fun textStyle(): TextStyle {
        val type = MaterialTheme.typography
        return if (this == Page) type.bodyLarge.copy(lineHeight = type.bodyLarge.fontSize * 1.5f) else type.bodyMedium
    }

    @Composable
    fun color(): Color = if (this == Page) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * Agent-authored markdown, formatted by the core (`formatMarkdown`) and drawn block by block. Every
 * string an agent wrote is drawn through this or [FormatBlockView], never a bare `Text`.
 * [streaming] while more text is coming; [limit] blocks are drawn, the rest is for a sheet of its own.
 */
@Composable
fun FormattedText(text: String, modifier: Modifier = Modifier, role: FormatRole = FormatRole.Page, streaming: Boolean = false, limit: Int? = null) {
    val blocks = remember(text, streaming) { FormatCache.blocks(text, streaming) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(role.blockSpacing)) {
        (if (limit != null) blocks.take(limit) else blocks).forEach { block -> FormatBlockView(block, role = role) }
    }
}

/**
 * Formatted blocks kept by text, so a finished text is parsed once however often it is composed and
 * a streaming one once per batch. Shared by composition and the row builder's background thread.
 */
object FormatCache {
    private const val MAX_TEXTS = 2_000

    private data class Key(val text: String, val streaming: Boolean)

    private val parsed = object : LinkedHashMap<Key, List<FormatBlock>>(MAX_TEXTS, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, List<FormatBlock>>) = size > MAX_TEXTS
    }

    fun blocks(text: String, streaming: Boolean): List<FormatBlock> {
        val key = Key(text, streaming)
        synchronized(parsed) { parsed[key] }?.let { return it }
        val blocks = formatMarkdown(text, streaming)
        synchronized(parsed) { parsed[key] = blocks }
        return blocks
    }
}
