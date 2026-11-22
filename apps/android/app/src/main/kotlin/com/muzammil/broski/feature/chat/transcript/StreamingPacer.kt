package com.muzammil.broski.feature.chat.transcript

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import uniffi.broski_contract.OpenBlock
import kotlin.math.ceil

/**
 * Smooths bursty streaming block updates into a steady ~60 Hz reveal. Runs a pacing coroutine only
 * while `displayed != target`, so idle chats cost zero CPU.
 */
class StreamingPacer(private val scope: CoroutineScope) {
    private val mutableBlocks = MutableStateFlow<List<OpenBlock>>(emptyList())
    val blocks: StateFlow<List<OpenBlock>> = mutableBlocks.asStateFlow()

    private val targets = LinkedHashMap<String, OpenBlock>()
    private val displayed = HashMap<String, String>()
    private var ticker: Job? = null

    fun sync(incoming: List<OpenBlock>, animated: Boolean) {
        val activeIds = incoming.mapTo(HashSet()) { it.blockId }
        targets.keys.retainAll(activeIds)
        displayed.keys.retainAll(activeIds)

        for (block in incoming) {
            val id = block.blockId
            val hadTarget = id in targets
            targets[id] = block
            val shown = displayed[id]
            if (!animated) {
                displayed[id] = block.text
            } else if (shown != null && block.text.startsWith(shown)) {
                // Keep advancing from the already-revealed prefix.
            } else if (!hadTarget) {
                displayed[id] = if (block.text.length <= 8) block.text else advance("", block.text)
            } else {
                displayed[id] = block.text
            }
        }

        publish()
        updateTicker()
    }

    fun flush() {
        targets.forEach { (id, block) -> displayed[id] = block.text }
        stop()
        publish()
    }

    fun reset() {
        targets.clear()
        displayed.clear()
        stop()
        mutableBlocks.value = emptyList()
    }

    fun stop() {
        ticker?.cancel()
        ticker = null
    }

    private fun updateTicker() {
        val hasPending = targets.any { (id, block) -> displayed[id] != block.text }
        if (!hasPending) {
            stop()
            return
        }
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (true) {
                delay(FRAME_MS)
                var changed = false
                var stillPending = false
                for ((id, block) in targets) {
                    val target = block.text
                    val shown = displayed[id] ?: continue
                    if (shown == target) continue
                    val next = if (target.startsWith(shown)) advance(shown, target) else target
                    if (next != shown) {
                        displayed[id] = next
                        changed = true
                    }
                    if (next != target) stillPending = true
                }
                if (changed) publish()
                if (!stillPending) break
            }
            ticker = null
        }
    }

    private fun publish() {
        mutableBlocks.value = targets.values.map { block ->
            val shown = displayed[block.blockId] ?: block.text
            if (shown == block.text) block else block.copy(text = shown)
        }
    }

    companion object {
        private const val FRAME_MS = 16L

        internal fun advance(shown: String, target: String): String {
            val start = shown.length
            val backlog = target.length - start
            if (backlog <= 0) return target
            val baseStep = maxOf(2, ceil(backlog / 5.0).toInt())
            if (baseStep >= backlog) return target
            var cut = start + baseStep
            if (backlog > 12) {
                val limit = minOf(target.length, cut + 4)
                for (index in cut until limit) {
                    if (target[index].isWhitespace()) {
                        cut = index + 1
                        break
                    }
                }
            }
            // Avoid splitting a UTF-16 surrogate pair (e.g., emoji).
            if (cut < target.length && Character.isLowSurrogate(target[cut])) cut += 1
            return target.substring(0, cut.coerceAtMost(target.length))
        }
    }
}
