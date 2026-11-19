package com.muzammil.broski.design.orb

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

private fun smoothE(x: Double): Double = x * x * (3 - 2 * x)

private const val HOLD = 1.4
private const val MORPH = 0.9
private const val SEG = HOLD + MORPH
private const val POINTS = 160

/**
 * A closed outline parameterised by arc length from the top centre, clockwise: the circle, or a
 * polygon whose vertices are [vx] and [vy] (null for the circle).
 */
private class Outline(private val vx: DoubleArray?, private val vy: DoubleArray?) {
    private val segLengths: DoubleArray
    private val total: Double

    init {
        if (vx != null && vy != null) {
            segLengths = DoubleArray(vx.size) { i ->
                val j = (i + 1) % vx.size
                Math.sqrt((vx[j] - vx[i]) * (vx[j] - vx[i]) + (vy[j] - vy[i]) * (vy[j] - vy[i]))
            }
            total = segLengths.sum()
        } else {
            segLengths = DoubleArray(0)
            total = 0.0
        }
    }

    /** The point a fraction [f] of the way round, into [out]. */
    fun point(f: Double, out: DoubleArray) {
        if (vx == null || vy == null) {
            val a = -Math.PI / 2 + f * 2 * Math.PI
            out[0] = cos(a) * 0.24
            out[1] = sin(a) * 0.24
            return
        }
        var target = f * total
        var i = 0
        while (target > segLengths[i] && i < vx.size - 1) {
            target -= segLengths[i]
            i++
        }
        val j = (i + 1) % vx.size
        val ff = if (segLengths[i] != 0.0) minOf(1.0, target / segLengths[i]) else 0.0
        out[0] = vx[i] + (vx[j] - vx[i]) * ff
        out[1] = vy[i] + (vy[j] - vy[i]) * ff
    }
}

private val Triangle = Outline(doubleArrayOf(0.0, 0.24, -0.24), doubleArrayOf(-0.26, 0.16, 0.16))

// five vertices, so the walk starts at the top centre like the other shapes
private val Square = Outline(
    doubleArrayOf(0.0, 0.2, 0.2, -0.2, -0.2),
    doubleArrayOf(-0.2, -0.2, 0.2, 0.2, -0.2),
)
private val Cycle = listOf(Outline(null, null), Triangle, Square)

// a low floor keeps sparse outlines possible while never degenerating
private fun morphN(d: Double): Int = maxOf(6, roundHalfAway(34 * d).toInt())

/** The outline [from] blended into [to] by [m] as [POINTS] points, scaled by [spread], and its length. */
private class Blend(from: Outline, to: Outline, m: Double, spread: Double) {
    val px = DoubleArray(POINTS)
    val py = DoubleArray(POINTS)
    val lengths = DoubleArray(POINTS)
    var total = 0.0

    init {
        val a = DoubleArray(2)
        val b = DoubleArray(2)
        for (i in 0 until POINTS) {
            val f = i.toDouble() / POINTS
            from.point(f, a)
            to.point(f, b)
            px[i] = (a[0] + (b[0] - a[0]) * m) * spread
            py[i] = (a[1] + (b[1] - a[1]) * m) * spread
        }
        for (i in 0 until POINTS) {
            val j = (i + 1) % POINTS
            lengths[i] = Math.sqrt((px[j] - px[i]) * (px[j] - px[i]) + (py[j] - py[i]) * (py[j] - py[i]))
            total += lengths[i]
        }
    }
}

/** A dotted outline cycling circle, triangle, square, circle: the `shaping` state. */
internal fun frameMorph(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val k = Cycle.size
    val tc = t % (SEG * k)
    val index = floor(tc / SEG).toInt()
    val local = tc - index * SEG
    val m = if (local > HOLD) smoothE((local - HOLD) / MORPH) else 0.0
    val sprd = o.opt("spread", 1.0)

    // blend the two shapes' paths at m, then measure the blended outline
    val outline = Blend(Cycle[index], Cycle[(index + 1) % k], m, sprd)

    // dot radius depends only on rDot (the size knob); the count sets the gaps. Formed shapes
    // breathe a little (a uniform pulse).
    val n = morphN(o.opt("iconD", 1.0))
    val re = o.opt("rDot", 0.021) * 1.35 * sprd
    val pulse = 1 + 0.02 * sin(local * 3.1)

    val c2 = size / 2
    var seg = 0
    var acc = 0.0
    for (k2 in 0 until n) {
        val target = (k2.toDouble() / n) * outline.total
        while (acc + outline.lengths[seg] < target && seg < POINTS - 1) {
            acc += outline.lengths[seg]
            seg++
        }
        val next = (seg + 1) % POINTS
        val f = if (outline.lengths[seg] != 0.0) minOf(1.0, (target - acc) / outline.lengths[seg]) else 0.0
        val x = (outline.px[seg] + (outline.px[next] - outline.px[seg]) * f) * pulse
        val y = (outline.py[seg] + (outline.py[next] - outline.py[seg]) * f) * pulse
        into.dot(c2 + x * size, c2 + y * size, 0.0, maxOf(0.35, re * size), 0.1)
    }
    into.finish(o.opt("rMin", 0.3))
}
