package com.muzammil.broski.design.orb

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.sin

/**
 * One rendered instant of an orb, a complete and final set of draw instructions, held as parallel
 * arrays so that a frame costs no allocation once its arrays have grown to fit. After [finish] the
 * dots are z-sorted far to near and radius-clamped, and index `i` of every accessor is the i-th dot
 * to draw; lines are drawn first.
 *
 * `white` is ink: 0 is the darkest ink on paper, mirrored on dark themes.
 */
class OrbFrame {
    private var xs = DoubleArray(INITIAL_DOTS)
    private var ys = DoubleArray(INITIAL_DOTS)
    private var zs = DoubleArray(INITIAL_DOTS)
    private var radii = DoubleArray(INITIAL_DOTS)
    private var whites = DoubleArray(INITIAL_DOTS)
    private var alphas = DoubleArray(INITIAL_DOTS)
    private var order = IntArray(INITIAL_DOTS)
    private var merge = IntArray(INITIAL_DOTS)
    private var rawDots = 0

    private var lineData = DoubleArray(INITIAL_LINES * LINE_STRIDE)
    private var rawLines = 0

    var dotCount = 0
        private set
    var lineCount = 0
        private set

    fun x(i: Int): Double = xs[order[i]]
    fun y(i: Int): Double = ys[order[i]]
    fun z(i: Int): Double = zs[order[i]]
    fun r(i: Int): Double = radii[order[i]]
    fun white(i: Int): Double = whites[order[i]]
    fun a(i: Int): Double = alphas[order[i]]

    fun lineX1(i: Int): Double = lineData[i * LINE_STRIDE]
    fun lineY1(i: Int): Double = lineData[i * LINE_STRIDE + 1]
    fun lineX2(i: Int): Double = lineData[i * LINE_STRIDE + 2]
    fun lineY2(i: Int): Double = lineData[i * LINE_STRIDE + 3]
    fun lineWhite(i: Int): Double = lineData[i * LINE_STRIDE + 4]
    fun lineA(i: Int): Double = lineData[i * LINE_STRIDE + 5]
    fun lineW(i: Int): Double = lineData[i * LINE_STRIDE + 6]

    internal fun reset() {
        rawDots = 0
        rawLines = 0
        dotCount = 0
        lineCount = 0
    }

    internal fun dot(x: Double, y: Double, z: Double, r: Double, white: Double, a: Double = 1.0) {
        if (rawDots == xs.size) grow()
        xs[rawDots] = x
        ys[rawDots] = y
        zs[rawDots] = z
        radii[rawDots] = r
        whites[rawDots] = white
        alphas[rawDots] = a
        rawDots++
    }

    internal fun line(x1: Double, y1: Double, x2: Double, y2: Double, white: Double, a: Double, w: Double) {
        if ((rawLines + 1) * LINE_STRIDE > lineData.size) lineData = lineData.copyOf(lineData.size * 2)
        val b = rawLines * LINE_STRIDE
        lineData[b] = x1
        lineData[b + 1] = y1
        lineData[b + 2] = x2
        lineData[b + 3] = y2
        lineData[b + 4] = white
        lineData[b + 5] = a
        lineData[b + 6] = w
        rawLines++
    }

    /**
     * Turns the raw marks into a finished frame: drops invisible ones, clamps radii to the mode's
     * floor and z-sorts far to near.
     *
     * The sort is stable (ties keep emission order), as JavaScript's is: `shaping` puts every dot
     * at z = 0, so the order of ties is part of what the golden vectors hold.
     */
    internal fun finish(rMin: Double) {
        var n = 0
        for (i in 0 until rawDots) {
            if (alphas[i] >= MIN_ALPHA) {
                if (radii[i] < rMin) radii[i] = rMin
                order[n++] = i
            }
        }
        sortByZ(n)
        dotCount = n

        var kept = 0
        for (i in 0 until rawLines) {
            if (lineData[i * LINE_STRIDE + 5] >= MIN_ALPHA) {
                if (kept != i) System.arraycopy(lineData, i * LINE_STRIDE, lineData, kept * LINE_STRIDE, LINE_STRIDE)
                kept++
            }
        }
        lineCount = kept
    }

    private fun sortByZ(n: Int) {
        var width = 1
        var from = order
        var to = merge
        while (width < n) {
            var lo = 0
            while (lo < n) {
                val mid = minOf(lo + width, n)
                val hi = minOf(lo + 2 * width, n)
                var i = lo
                var j = mid
                for (k in lo until hi) {
                    to[k] = if (i < mid && (j >= hi || zs[from[j]] >= zs[from[i]])) from[i++] else from[j++]
                }
                lo = hi
            }
            val swap = from
            from = to
            to = swap
            width *= 2
        }
        if (from !== order) System.arraycopy(from, 0, order, 0, n)
    }

    private fun grow() {
        val size = xs.size * 2
        xs = xs.copyOf(size)
        ys = ys.copyOf(size)
        zs = zs.copyOf(size)
        radii = radii.copyOf(size)
        whites = whites.copyOf(size)
        alphas = alphas.copyOf(size)
        order = order.copyOf(size)
        merge = merge.copyOf(size)
    }

    private companion object {
        const val INITIAL_DOTS = 512
        const val INITIAL_LINES = 64
        const val LINE_STRIDE = 7
        const val MIN_ALPHA = 0.02
    }
}

/** Deterministic hash in [0, 1). */
internal fun hashD(a: Double, b: Double): Double {
    val h = sin(a * 12.9898 + b * 78.233) * 43758.5453
    return h - floor(h)
}

/** Value noise on a 2D lattice: smooth, deterministic, cheap. */
internal fun vnoise(x: Double, y: Double): Double {
    val xi = floor(x)
    val yi = floor(y)
    var fx = x - xi
    var fy = y - yi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    val a = hashD(xi, yi)
    val b = hashD(xi + 1, yi)
    val c = hashD(xi, yi + 1)
    val d = hashD(xi + 1, yi + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

private val Golden = Math.PI * (3 - Math.sqrt(5.0))

/** Direction `i` of `n` stable ones on a unit sphere (a Fibonacci lattice), into [out]. */
internal fun fibDir(i: Int, n: Int, out: DoubleArray) {
    val y = 1 - (2 * (i + 0.5)) / n
    val rad = Math.sqrt(1 - y * y)
    val a = i * Golden
    out[0] = rad * cos(a)
    out[1] = y
    out[2] = rad * sin(a)
}

/** Shortest signed angular distance, wrapped to (-π, π]. */
internal fun angleDelta(a: Double, b: Double): Double = atan2(sin(a - b), cos(a - b))

internal fun lerp(a: Double, b: Double, f: Double): Double = a + (b - a) * f

internal fun frac(x: Double): Double = x - floor(x)

/** Rounds half away from zero, as the engine's reference does; Kotlin's `round` is half-to-even. */
internal fun roundHalfAway(x: Double): Double = if (x < 0) -floor(-x + 0.5) else floor(x + 0.5)

/**
 * An ink value as the 8-bit grey the canvas painter lands on, so every platform draws identical
 * greys rather than merely close ones; mirrored on dark themes.
 */
internal fun inkGrey(white: Double, dark: Boolean): Int {
    val w = minOf(1.0, maxOf(0.0, white))
    return roundHalfAway((if (dark) 1 - w else w) * 255).toInt()
}

/** Shared spin, tilt and orthographic projection; [project] leaves the point in [x], [y] and [z]. */
internal class Projector(yaw: Double, tilt: Double, private val cx: Double, private val cy: Double, private val scale: Double) {
    private val st = sin(tilt)
    private val ct = cos(tilt)
    private val sy = sin(yaw)
    private val cyw = cos(yaw)

    var x = 0.0
        private set
    var y = 0.0
        private set
    var z = 0.0
        private set

    fun project(px: Double, py: Double, pz: Double) {
        val x1 = px * cyw + pz * sy
        val z1 = -px * sy + pz * cyw
        val y1 = py * ct - z1 * st
        z = py * st + z1 * ct
        x = cx + x1 * scale
        y = cy - y1 * scale
    }
}

/** Dot radii were tuned for a 300 pt frame; sub-linear scaling keeps small spinners legible. */
internal fun radiusScale(size: Double, pow: Double): Double = (size / 300).pow(pow)
