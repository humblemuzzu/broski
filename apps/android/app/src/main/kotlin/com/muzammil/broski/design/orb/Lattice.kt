package com.muzammil.broski.design.orb

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

/** Dots on one latitude ring: as many as its circumference earns at [lonDensity], at least one. */
internal fun lonCount(cosLat: Double, lonDensity: Double): Int =
    maxOf(1, roundHalfAway(abs(cosLat) * lonDensity).toInt())

/** A lat/long field with a scan meridian sweeping across it, the `searching` state. */
internal fun frameGlobe(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val spin = 0.5
    val cx = size / 2
    val cy = size / 2
    val radius = (size / 2) * 0.82
    val tilt = 0.4 + 0.06 * sin(t * 0.35)
    val pt = Projector(yaw = t * spin, tilt = tilt, cx = cx, cy = cy, scale = radius)
    // the scan sweeps relative to the spin; scanMul scales that relative rate
    val scan = t * (spin + (1.7 - spin) * o.opt("scanMul", 1.0))
    val rs = radiusScale(size, o.opt("rsPow", 0.6))
    val dimBase = o.opt("dimBase", 1.0)
    val rBase = o.opt("rBase", 0.6)
    val rDepth = o.opt("rDepth", 1.7)
    val rBoost = o.opt("rBoost", 1.0)
    val inkFar = o.opt("inkFar", 0.62)
    val inkSpan = o.opt("inkSpan", 0.54)

    val latRings = o.opt("latRings", 17.0).toInt()
    val lonDensity = o.opt("lonDensity", 44.0)
    for (li in 0..latRings) {
        val lat = -Math.PI / 2 + (li.toDouble() / latRings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        val count = lonCount(cosLat, lonDensity)
        for (lj in 0 until count) {
            val lon = (lj.toDouble() / count) * 2 * Math.PI
            pt.project(cosLat * cos(lon), sinLat, cosLat * sin(lon))
            val depth = (pt.z + 1) / 2
            // the scan: a moving meridian read as a size ripple, not a shine
            val d = angleDelta(lon + t * spin, scan)
            val boost = exp(-(d * d) / 0.18) * maxOf(0.0, pt.z)
            into.dot(
                pt.x, pt.y, pt.z,
                (rBase + rDepth * depth + rBoost * boost) * rs,
                inkFar - inkSpan * depth,
                // dimBase < 1 fades the un-scanned dots so the meridian reads clearly
                dimBase + (1 - dimBase) * minOf(1.0, boost),
            )
        }
    }
    into.finish(o.opt("rMin", 0.3))
}

/** A waveform rolls through the rings, the `listening` state. */
internal fun frameWave(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val cx = size / 2
    val cy = size / 2
    // 0.76 base × 1.15: the undulation pulls the sphere inward, so wave read ~15% smaller than
    // the other lattice modes; scaled up to match them
    val radius = (size / 2) * 0.874
    val pt = Projector(yaw = t * 0.18, tilt = 0.38, cx = cx, cy = cy, scale = 1.0)
    val rs = radiusScale(size, o.opt("rsPow", 0.6))
    val rBase = o.opt("rBase", 0.6)
    val rDepth = o.opt("rDepth", 1.7)

    val rings = o.opt("rings", 15.0).toInt()
    val lonDensity = o.opt("lonDensity", 40.0)
    for (ri in 0..rings) {
        val lat = -Math.PI / 2 + (ri.toDouble() / rings) * Math.PI
        val cosLat = cos(lat)
        val sinLat = sin(lat)
        // two waves at different tempi: organic, never quite repeating
        val w = 0.62 * sin(t * 2.1 - ri * 0.52) + 0.38 * sin(t * 1.27 + ri * 0.83)
        val rr = radius * (0.88 + 0.105 * w)
        val crest = maxOf(0.0, w)
        val count = lonCount(cosLat, lonDensity)
        for (lj in 0 until count) {
            val lon = (lj.toDouble() / count) * 2 * Math.PI
            pt.project(cosLat * cos(lon) * rr, sinLat * rr, cosLat * sin(lon) * rr)
            val depth = (pt.z / radius + 1) / 2
            into.dot(
                pt.x, pt.y, pt.z,
                (rBase + rDepth * depth) * (1 + 0.4 * crest) * rs,
                0.66 - 0.56 * depth - 0.1 * crest,
            )
        }
    }
    into.finish(o.opt("rMin", 0.3))
}
