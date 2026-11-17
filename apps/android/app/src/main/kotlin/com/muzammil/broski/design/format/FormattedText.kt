package com.muzammil.broski.design.format

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import uniffi.broski_core.FormatBlock
import uniffi.broski_core.formatMarkdown
import uniffi.broski_core.formatMessage
import uniffi.broski_core.formatPlainText

/**
 * Agent-authored markdown, formatted by the core (`formatMarkdown`) and drawn block by block. Every
 * string an agent wrote is drawn through this, [FormatBlockView], [FormattedMessage] or a tool view
 * built on the core's output, never a bare `Text`. [streaming] while more text is coming; [limit]
 * blocks are drawn, the rest is for a sheet of its own; [menu] offers Copy, Copy as plain text,
 * Select text and Share on a long press.
 */
@Composable
fun FormattedText(
    text: String,
    modifier: Modifier = Modifier,
    role: FormatRole = FormatRole.Page,
    streaming: Boolean = false,
    limit: Int? = null,
    menu: Boolean = true,
) {
    val blocks = remember(text, streaming) { FormatCache.blocks(text, streaming) }
    val shown = if (limit != null) blocks.take(limit) else blocks
    if (menu) {
        AnswerMenu({ text }, modifier) { FormatBlockList(shown, role, streaming) }
    } else {
        FormatBlockList(shown, role, streaming, modifier)
    }
}

/** The person's own message or a notice: inline styles and fenced code, every other line exactly as typed. */
@Composable
fun FormattedMessage(text: String, modifier: Modifier = Modifier, role: FormatRole = FormatRole.Page) {
    val blocks = remember(text) { FormatCache.message(text) }
    FormatBlockList(blocks, role, streaming = false, modifier = modifier)
}

/** Blocks in order, each told the containers of the one after it. */
@Composable
fun FormatBlockList(blocks: List<FormatBlock>, role: FormatRole, streaming: Boolean, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        blocks.forEachIndexed { index, block ->
            key(block.key) {
                val next = blocks.getOrNull(index + 1)?.containers?.map { it.id }.orEmpty()
                FormatBlockView(block, role = role, next = next, streaming = streaming && index == blocks.lastIndex)
            }
        }
    }
}

/** Whether [text] has more blocks than [limit] draws. */
fun exceeds(text: String, limit: Int): Boolean = FormatCache.blocks(text, false).size > limit

/**
 * One line an agent wrote (an ask's title, an option's label, a task's name) as the plain words it
 * says: its markers never show, and it takes the style of where it is drawn.
 */
fun agentLine(text: String): String = formatPlainText(text)

/**
 * Formatted blocks kept by text, so a finished text is parsed once however often it is composed and
 * a streaming one once per batch. Shared by composition and the row builder's background thread.
 */
object FormatCache {
    private const val MAX_TEXTS = 2_000
    private const val MAX_TEXT_CHARS = 16 shl 20
    private const val MAX_STREAMING = 16

    private data class Key(val text: String, val streaming: Boolean, val message: Boolean)

    /** Finished texts, least recently used out first past 2,000 of them or 16 Mi characters. */
    private val finished = LinkedHashMap<Key, List<FormatBlock>>(MAX_TEXTS, 0.75f, true)
    private var finishedChars = 0

    /** A streaming text is asked for again only within its batch: only the last few are kept. */
    private val streaming = object : LinkedHashMap<Key, List<FormatBlock>>(MAX_STREAMING, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, List<FormatBlock>>) = size > MAX_STREAMING
    }

    fun blocks(text: String, streaming: Boolean): List<FormatBlock> =
        cached(Key(text, streaming, message = false)) { formatMarkdown(text, streaming) }

    fun message(text: String): List<FormatBlock> = cached(Key(text, streaming = false, message = true)) { formatMessage(text) }

    private fun cached(key: Key, parse: () -> List<FormatBlock>): List<FormatBlock> {
        val store = if (key.streaming) streaming else finished
        synchronized(this) { store[key] }?.let { return it }
        val blocks = parse()
        synchronized(this) {
            if (store.put(key, blocks) == null && !key.streaming) {
                finishedChars += key.text.length
                trimFinished()
            }
        }
        return blocks
    }

    private fun trimFinished() {
        val eldest = finished.keys.iterator()
        while ((finished.size > MAX_TEXTS || finishedChars > MAX_TEXT_CHARS) && finished.size > 1) {
            finishedChars -= eldest.next().text.length
            eldest.remove()
        }
    }
}
