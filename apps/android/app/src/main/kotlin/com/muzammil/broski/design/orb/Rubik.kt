package com.muzammil.broski.design.orb

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

/** The scramble: move `i` turns the band of the sphere whose `axis[i]` coordinate lies in `[lo[i], hi[i])` a quarter turn. */
private class Moves(val count: Int) {
    val axis = IntArray(count)
    val lo = DoubleArray(count)
    val hi = DoubleArray(count)
    val ang = DoubleArray(count)

    init {
        for (i in 0 until count) {
            axis[i] = minOf(2, floor(hashD(i.toDouble(), 2.3) * 3).toInt())
            lo[i] = -1.0 + 0.5 * minOf(3, floor(hashD(i.toDouble(), 5.9) * 4).toInt())
            hi[i] = lo[i] + 0.5
            ang[i] = (if (hashD(i.toDouble(), 7.7) < 0.5) 1 else -1) * Math.PI / 2
        }
    }
}

@Volatile
private var heldMoves = Moves(0)

private fun movesFor(count: Int): Moves {
    val held = heldMoves
    if (held.count == count) return held
    return Moves(count).also { heldMoves = it }
}

/**
 * The solver's heartbeat: rapid eased moves scramble, then replay in reverse so everything clicks
 * back to solved, rests, repeats. [amount] is how far each move has turned, [active] the one turning.
 */
private class SolveCycle(count: Int, time: Double, slotDur: Double, rest: Double) {
    val amount = DoubleArray(count)
    var active = -1

    init {
        val cyc = 2 * count * slotDur + rest
        val tc = time % cyc
        if (tc < 2 * count * slotDur) {
            val slot = floor(tc / slotDur).toInt()
            val p = (tc - slot * slotDur) / slotDur
            val cl = minOf(1.0, p / 0.7)
            val ep = 1 - Math.pow(1 - cl, 3.0) // machine ease-out
            if (slot < count) {
                for (i in 0 until slot) amount[i] = 1.0
                amount[slot] = ep
                active = slot
            } else {
                val u = 2 * count - 1 - slot
                for (i in 0 until u) amount[i] = 1.0
                amount[u] = 1 - ep
                active = u
            }
        }
    }
}

/** Turns a unit-sphere point through every move that has begun; the result is in [point]. */
private fun applyMoves(point: DoubleArray, moves: Moves, cycle: SolveCycle): Boolean {
    var x = point[0]
    var y = point[1]
    var z = point[2]
    var inActive = false
    for (i in 0 until moves.count) {
        if (cycle.amount[i] <= 0) continue
        val coord = when (moves.axis[i]) {
            0 -> x
            1 -> y
            else -> z
        }
        if (coord < moves.lo[i] || coord >= moves.hi[i]) continue
        if (i == cycle.active) inActive = true
        val a = moves.ang[i] * cycle.amount[i]
        val ca = cos(a)
        val sa = sin(a)
        when (moves.axis[i]) {
            0 -> {
                val y2 = y * ca - z * sa
                z = y * sa + z * ca
                y = y2
            }
            1 -> {
                val x2 = x * ca + z * sa
                z = -x * sa + z * ca
                x = x2
            }
            else -> {
                val x2 = x * ca - y * sa
                y = x * sa + y * ca
                x = x2
            }
        }
    }
    point[0] = x
    point[1] = y
    point[2] = z
    return inActive
}

/** Bands twist in quarter turns, scramble then solve, the `solving` state. */
internal fun frameRubik(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val cx = size / 2
    val cy = size / 2
    val radius = (size / 2) * 0.82
    val pt = Projector(yaw = t * 0.55, tilt = 0.35 + 0.1 * sin(t * 0.9), cx = cx, cy = cy, scale = radius)
    val rs = radiusScale(size, o.opt("rsPow", 0.6))
    val moveCount = o.opt("moveCount", 14.0).toInt()
    val turns = movesFor(moveCount)
    val cycle = SolveCycle(moveCount, t, 0.42, 1.2)
    val rBase = o.opt("rBase", 0.6)
    val rDepth = o.opt("rDepth", 1.7)
    val rActive = o.opt("rActive", 0.3)
    val inkFar = o.opt("inkFar", 0.62)
    val inkSpan = o.opt("inkSpan", 0.54)

    val point = DoubleArray(3)
    val latRings = o.opt("latRings", 15.0).toInt()
    val lonDensity = o.opt("lonDensity", 40.0)
    for (li in 0..latRings) {
        val lat = -Math.PI / 2 + (li.toDouble() / latRings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val count = lonCount(cosLat, lonDensity)
        for (lj in 0 until count) {
            val lon = (lj.toDouble() / count) * 2 * Math.PI
            point[0] = cosLat * cos(lon)
            point[1] = sinLat
            point[2] = cosLat * sin(lon)
            val inActive = applyMoves(point, turns, cycle)
            pt.project(point[0], point[1], point[2])
            val depth = (pt.z + 1) / 2
            // the band being turned inks a touch darker: the "hand"
            into.dot(
                pt.x, pt.y, pt.z,
                (rBase + rDepth * depth + (if (inActive) rActive else 0.0)) * rs,
                inkFar - inkSpan * depth - (if (inActive) 0.14 else 0.0),
            )
        }
    }
    into.finish(o.opt("rMin", 0.3))
}
