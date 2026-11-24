package com.muzammil.broski.feature.chat.composer

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The model wheel seen as a drum from the front: a row `d` rows from the band is turned `d`·[STEP]
 * degrees away, so it shows nearer the band and squashed, and is gone edge-on at 90°. Distances are
 * in rows, fractional while the wheel turns.
 */
internal object Drum {
    const val STEP = 28f
    private val step = Math.toRadians(STEP.toDouble()).toFloat()

    fun angle(d: Float): Float = (d * STEP).coerceIn(-90f, 90f)

    /** Where row `d` shows, in rows from the band. */
    fun shown(d: Float): Float = sin(Math.toRadians(angle(d).toDouble())).toFloat() / step

    /** The row under a point `y` rows from the band: the inverse of [shown]. */
    fun under(y: Float): Float = asin((y * step).coerceIn(-1f, 1f)) / step

    /** Full in the band, half a row away already faint, gone past two and a half. */
    fun alpha(d: Float): Float {
        val away = abs(d)
        return when {
            away <= 1f -> 1f - 0.55f * away
            else -> (0.45f - 0.3f * (away - 1f)).coerceAtLeast(0f)
        }
    }

    /** What only the band's row shows (its level) fades out within a quarter row. */
    fun detailAlpha(d: Float): Float = (1f - abs(d) * 4f).coerceIn(0f, 1f)

    /** A drag of `by` rows from `position`, resisted past either end and held within [OVERSCROLL]. */
    fun dragged(position: Float, by: Float, last: Int): Float {
        val beyond = position < 0f || position > last || position + by < 0f || position + by > last
        val next = position + if (beyond) by * RESISTANCE else by
        return next.coerceIn(-OVERSCROLL, last + OVERSCROLL)
    }

    /** How many rows tall the wheel is for [count] models: enough to show the turned rows, no more. */
    fun rows(count: Int): Float = when {
        count <= 1 -> 1f
        count == 2 -> 3f
        else -> 4.4f
    }

    private const val RESISTANCE = 0.3f
    private const val OVERSCROLL = 0.6f
}

/**
 * Where each thinking level sits on a track [width] wide, lowest first: evenly from [lead] in to
 * [trail] from the end. The fill runs from the track's start to [trail] past the handle, so the lowest
 * level is still a short pill and the highest fills the track.
 */
internal class LevelTrack(val count: Int, val width: Float, val lead: Float, val trail: Float) {
    private val step: Float = if (count > 1) (width - lead - trail) / (count - 1) else 0f

    fun x(index: Int): Float = lead + index.coerceIn(0, (count - 1).coerceAtLeast(0)) * step

    fun clamp(x: Float): Float = x.coerceIn(x(0), x(count - 1))

    fun nearest(x: Float): Int = if (step == 0f) 0 else ((clamp(x) - lead) / step).roundToInt().coerceIn(0, count - 1)
}
