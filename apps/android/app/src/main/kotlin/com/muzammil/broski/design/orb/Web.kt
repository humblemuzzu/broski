package com.muzammil.broski.design.orb

import kotlin.math.floor
import kotlin.math.sin

/** The nodes of the constellation as unit vectors: a Fibonacci lattice wandering under slow value noise. */
private class Nodes(count: Int, t: Double) {
    val x = DoubleArray(count)
    val y = DoubleArray(count)
    val z = DoubleArray(count)

    init {
        val dir = DoubleArray(3)
        for (i in 0 until count) {
            fibDir(i, count, dir)
            val nx = dir[0] + 0.3 * (vnoise(i * 0.31 + 9, t * 0.24) - 0.5) * 2
            val ny = dir[1] + 0.3 * (vnoise(i * 0.53 + 27, t * 0.21) - 0.5) * 2
            val nz = dir[2] + 0.3 * (vnoise(i * 0.77 + 55, t * 0.27) - 0.5) * 2
            val l = Math.sqrt(nx * nx + ny * ny + nz * nz)
            x[i] = nx / l
            y[i] = ny / l
            z[i] = nz / l
        }
    }
}

/** Edges between close neighbours, alpha by proximity and depth. */
private fun webEdges(into: OrbFrame, pt: Projector, nodes: Nodes, thr: Double, lineW: Double) {
    for (i in nodes.x.indices) {
        for (j in i + 1 until nodes.x.size) {
            val dx = nodes.x[i] - nodes.x[j]
            val dy = nodes.y[i] - nodes.y[j]
            val dz = nodes.z[i] - nodes.z[j]
            val dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (dist >= thr) continue
            pt.project(nodes.x[i], nodes.y[i], nodes.z[i])
            val x1 = pt.x
            val y1 = pt.y
            val z1 = pt.z
            pt.project(nodes.x[j], nodes.y[j], nodes.z[j])
            val depth = ((z1 + pt.z) / 2 + 1) / 2
            into.line(x1, y1, pt.x, pt.y, 0.42, (1 - dist / thr) * (0.3 + 0.55 * depth), lineW)
        }
    }
}

/** Bright packets running between paired nodes, the pairs re-picked every so often. */
private fun webSignals(into: OrbFrame, pt: Projector, nodes: Nodes, t: Double, count: Int, nodeR: Double, nodeRDepth: Double, rs: Double) {
    val n = nodes.x.size
    for (s in 0 until count) {
        val seg = floor(t * 0.55 + s * 7.31)
        val a = floor(hashD(seg, s * 3.1 + 1.7) * n).toInt()
        val b = floor(hashD(seg, s * 5.7 + 4.2) * n).toInt()
        if (a == b) continue
        val f = frac(t * 0.55 + s * 7.31)
        val x = lerp(nodes.x[a], nodes.x[b], f)
        val y = lerp(nodes.y[a], nodes.y[b], f)
        val z = lerp(nodes.z[a], nodes.z[b], f)
        val l = maxOf(1e-6, Math.sqrt(x * x + y * y + z * z))
        pt.project(x / l, y / l, z / l)
        val depth = (pt.z + 1) / 2
        into.dot(pt.x, pt.y, pt.z, (nodeR * 1.5 + nodeRDepth * depth) * rs, 0.05, 0.5 + 0.5 * depth)
    }
}

/**
 * A constellation wires itself, the `connecting` state. Nodes drift on the sphere under slow value
 * noise; any pair closer than `thr` grows an edge, and bright packets run along randomly re-picked
 * node pairs.
 */
internal fun frameWeb(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val radius = (size / 2) * 0.8 * o.opt("spread", 1.0)
    // the projector carries the radius as its scale, so node vectors stay unit length and the
    // distances in the edges are in unit-sphere space
    val pt = Projector(yaw = t * 0.12, tilt = 0.32, cx = size / 2, cy = size / 2, scale = radius)
    val rs = radiusScale(size, o.opt("rsPow", 0.6))
    val nodeR = o.opt("nodeR", 1.4)
    val nodeRDepth = o.opt("nodeRDepth", 1.8)

    val nodes = Nodes(o.opt("nodeN", 30.0).toInt(), t)
    webEdges(into, pt, nodes, o.opt("thr", 0.72), maxOf(0.6, o.opt("lineW", 0.8) * rs))
    for (i in nodes.x.indices) {
        pt.project(nodes.x[i], nodes.y[i], nodes.z[i])
        val depth = (pt.z + 1) / 2
        val pulse = 1 + 0.25 * sin(t * 1.4 + i * 2.7)
        into.dot(pt.x, pt.y, pt.z, (nodeR + nodeRDepth * depth) * pulse * rs, 0.55 - 0.45 * depth)
    }
    webSignals(into, pt, nodes, t, o.opt("signals", 5.0).toInt(), nodeR, nodeRDepth, rs)
    into.finish(o.opt("rMin", 0.3))
}
