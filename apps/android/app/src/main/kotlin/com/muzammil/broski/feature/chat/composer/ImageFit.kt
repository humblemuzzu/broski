package com.muzammil.broski.feature.chat.composer

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/** The images of one prompt hold at most this much base64 together (the contract's `MAX_IMAGE_CHARS`). */
const val MAX_IMAGE_CHARS = 4 * 1_048_576

/** The longest side an image is sent at: models scale larger ones down themselves. */
const val MAX_SIDE = 2_048

/** Below this longest side an image says too little to be worth sending. */
const val MIN_SIDE = 320

private val QUALITIES = listOf(85, 70, 55)
private const val SHRINK = 0.75

fun base64Length(bytes: Int): Int = 4 * ceil(bytes / 3.0).toInt()

/** The pixel size an image of `width`×`height` is first tried at: its own, or [MAX_SIDE] on its longest side. */
fun startSize(width: Int, height: Int): Pair<Int, Int> {
    val scale = minOf(1.0, MAX_SIDE.toDouble() / max(width, height))
    return (width * scale).roundToInt().coerceAtLeast(1) to (height * scale).roundToInt().coerceAtLeast(1)
}

/**
 * The first encoding that fits [budget] base64 characters: at the start size through falling JPEG
 * qualities, then smaller by a quarter each round while the longest side stays at least
 * [MIN_SIDE]. `null` when none fits. [encode] takes a width, a height and a quality.
 */
fun fitImage(width: Int, height: Int, budget: Int, encode: (Int, Int, Int) -> ByteArray): ByteArray? {
    var (w, h) = startSize(width, height)
    while (true) {
        for (quality in QUALITIES) {
            val bytes = encode(w, h, quality)
            if (base64Length(bytes.size) <= budget) return bytes
        }
        val smaller = (w * SHRINK).roundToInt() to (h * SHRINK).roundToInt()
        if (max(smaller.first, smaller.second) < MIN_SIDE) return null
        w = smaller.first
        h = smaller.second
    }
}
