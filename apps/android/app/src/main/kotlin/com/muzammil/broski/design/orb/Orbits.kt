package com.muzammil.broski.design.orb

import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.sin

/** A circle through a random tilted plane of the sphere, of radius [ro]. */
private class OrbitPlane(h1: Double, h2: Double, radius: Double) {
    val ro = radius * (0.45 + 0.52 * h1)
    private val ux: Double
    private val uy: Double
    private val vx: Double
    private val vy: Double
    private val vz: Double

    init {
        val th = h1 * 2 * Math.PI
        val phi = acos(2 * h2 - 1)
        val nx = sin(phi) * cos(th)
        val ny = cos(phi)
        val nz = sin(phi) * sin(th)
        val ul = maxOf(1e-6, Math.sqrt(ny * ny + nx * nx))
        ux = -ny / ul
        uy = nx / ul
        vx = -nz * uy
        vy = nz * ux
        vz = nx * uy - ny * ux
    }

    /** Projects the point of the circle at angle [a]; the result is in [pt]. */
    fun project(pt: Projector, a: Double) {
        pt.project(
            (ux * cos(a) + vx * sin(a)) * ro,
            (uy * cos(a) + vy * sin(a)) * ro,
            vz * sin(a) * ro,
        )
    }
}

/** Particles on tilted orbits, the `working` state: ghost paths and the particles doing the work. */
internal fun frameOrbits(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val radius = (size / 2) * 0.82
    val pt = Projector(yaw = t * 0.12, tilt = 0.3, cx = size / 2, cy = size / 2, scale = 1.0)
    val rs = radiusScale(size, o.opt("rsPow", 0.6))

    val ghostN = o.opt("ghostN", 40.0).toInt()
    val particles = o.opt("particles", 3.0).toInt()
    val ghostR = o.opt("ghostR", 0.9)
    val ghostA = o.opt("ghostA", 0.5)
    val partR = o.opt("partR", 1.2)
    val partRDepth = o.opt("partRDepth", 1.6)

    for (orb in 0 until o.opt("orbitN", 12.0).toInt()) {
        val h1 = hashD(orb.toDouble(), 1.7)
        val h2 = hashD(orb.toDouble(), 5.2)
        val h3 = hashD(orb.toDouble(), 8.9)
        val plane = OrbitPlane(h1, h2, radius)
        val speed = (0.25 + 0.55 * h3) * (if (h3 > 0.5) 1 else -1)

        for (k in 0 until ghostN) {
            plane.project(pt, (k.toDouble() / ghostN) * 2 * Math.PI)
            val depth = (pt.z / plane.ro + 1) / 2
            into.dot(pt.x, pt.y, pt.z, ghostR * rs, 0.72, ghostA * (0.4 + 0.6 * depth))
        }
        for (m in 0 until particles) {
            plane.project(pt, t * speed + (m.toDouble() / particles) * 2 * Math.PI + h2 * 6)
            val depth = (pt.z / plane.ro + 1) / 2
            into.dot(pt.x, pt.y, pt.z, (partR + partRDepth * depth) * rs, 0.3 - 0.22 * depth)
        }
    }
    into.finish(o.opt("rMin", 0.3))
}
