package com.muzammil.broski.design.orb

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** Three strands plait around the sphere, the `weaving` state. */
internal fun frameBraid(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val cx = size / 2
    val cy = size / 2
    val radius = (size / 2) * 0.76
    val pt = Projector(yaw = t * 0.4, tilt = 0.3, cx = cx, cy = cy, scale = 1.0)
    val rs = radiusScale(size, o.opt("rsPow", 0.6))

    ghostSphere(into, pt, o.opt("ghostN", 150.0).toInt(), radius, rs)

    val strandN = o.opt("strandN", 52.0).toInt()
    val turns = o.opt("turns", 3.0)
    val rBase = o.opt("rBase", 1.2)
    val rDepth = o.opt("rDepth", 1.8)
    for (s in 0 until 3) {
        val phase = (s / 3.0) * 2 * Math.PI
        for (i in 0 until strandN) {
            // u walks pole to pole; the frac() drift slides the whole strand along
            val u = (frac(i.toDouble() / strandN + t * 0.045) * 2 - 1) * 0.96
            val surf = Math.sqrt(maxOf(0.0, 1 - u * u))
            val endFade = minOf(1.0, (1 - abs(u)) / 0.1)
            val a = u * Math.PI * turns + phase
            // radial breathing: strands trade places, the over/under of a plait
            val weave = 1 + 0.075 * sin(u * Math.PI * turns * 2 + phase * 2 + t * 0.8)
            val rr = surf * radius * weave
            pt.project(cos(a) * rr, u * radius * weave, sin(a) * rr)
            val depth = (pt.z / radius + 1) / 2
            into.dot(
                pt.x, pt.y, pt.z,
                (rBase + rDepth * depth) * rs,
                0.55 - 0.45 * depth,
                endFade * (0.45 + 0.55 * depth),
            )
        }
    }
    into.finish(o.opt("rMin", 0.3))
}

private fun ghostSphere(into: OrbFrame, pt: Projector, ghostN: Int, radius: Double, rs: Double) {
    val dir = DoubleArray(3)
    for (i in 0 until ghostN) {
        fibDir(i, ghostN, dir)
        pt.project(dir[0] * radius, dir[1] * radius, dir[2] * radius)
        val depth = (pt.z / radius + 1) / 2
        into.dot(pt.x, pt.y, pt.z, 0.8 * rs, 0.78, 0.1 + 0.22 * depth)
    }
}

/** The plane of the band: orthonormal u and v in it, and its normal n = u × v. */
private class BandPlane(ya: Double, ta: Double) {
    val ux = cos(ya)
    val uy = 0.0
    val uz = sin(ya)
    val vx = -uz * sin(ta)
    val vy = cos(ta)
    val vz = ux * sin(ta)
    val nx = uy * vz - uz * vy
    val ny = uz * vx - ux * vz
    val nz = ux * vy - uy * vx
}

/** The band's lanes, drawn round [plane] and undulating by [wobMul]; [baseR] is the radius the dots ride on. */
private class RibbonBand(
    private val into: OrbFrame,
    private val pt: Projector,
    private val plane: BandPlane,
    private val t: Double,
    private val faceOn: Boolean,
    private val wobMul: Double,
    private val baseR: Double,
    private val radius: Double,
    private val lanes: Int,
    private val segs: Int,
    private val rBase: Double,
    private val rDepth: Double,
    private val rs: Double,
) {
    fun lane(w: Int) {
        val laneOff = (w - (lanes - 1) / 2.0) * 0.075
        val edge = abs(w - (lanes - 1) / 2.0) / maxOf(1.0, (lanes - 1) / 2.0)
        for (k in 0 until segs) {
            val a = (k.toDouble() / segs) * 2 * Math.PI
            // two travelling waves along the band; wobMul scales the deformation, 0 is a clean band
            val wob = (0.16 * sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * sin(a * 5 + t * 1.1)) * wobMul
            // A normal-direction wobble is cancelled by the renormalisation below: the point lands
            // back on the sphere, so the silhouette is pinned and the deformation can only pull
            // dots inward. Face-on modulates the in-plane radius instead, so lobes swell and pinch.
            val radial = if (faceOn) 1 + wob else 1.0
            val off = if (faceOn) laneOff else laneOff + wob
            val x = plane.ux * cos(a) + plane.vx * sin(a) + plane.nx * off
            val y = plane.uy * cos(a) + plane.vy * sin(a) + plane.ny * off
            val z = plane.uz * cos(a) + plane.vz * sin(a) + plane.nz * off
            val l = Math.sqrt(x * x + y * y + z * z)
            val rr = baseR * radial
            pt.project((x / l) * rr, (y / l) * rr, (z / l) * rr)
            val depth = (pt.z / radius + 1) / 2
            into.dot(
                pt.x, pt.y, pt.z,
                (rBase + rDepth * depth) * (1 - 0.25 * edge) * rs,
                0.52 - 0.44 * depth + 0.18 * edge,
                0.4 + 0.6 * depth,
            )
        }
    }
}

/**
 * An undulating sash orbits the sphere, the `composing` state. The same geometry drives
 * `breathing` through the `faceOn` flag: a face-on circle whose radius undulates rather than its
 * out-of-plane offset, so it reads as a ring slowly morphing rather than a sash.
 */
internal fun frameRibbon(into: OrbFrame, size: Double, t: Double, o: Map<String, Double>) {
    val radius = (size / 2) * 0.78
    // spin scales the 3D tumble; spin = 0 freezes the band's orientation, leaving only the
    // travelling undulation
    val spin = o.opt("spin", 1.0)
    val camTilt = 0.3
    val faceOn = o.opt("faceOn", 0.0) != 0.0
    val pt = Projector(yaw = t * 0.1 * spin, tilt = camTilt, cx = size / 2, cy = size / 2, scale = 1.0)
    val rs = radiusScale(size, o.opt("rsPow", 0.6))

    val ghostN = o.opt("ghostN", 150.0).toInt()
    if (ghostN > 0) ghostSphere(into, pt, ghostN, radius, rs)

    // The band plane, precessing (frozen when spin = 0). The projection squashes the band's great
    // circle vertically by cos(ta + camTilt); face-on sets ta = -camTilt so that term is 1 and the
    // band reads as a true circle rather than the ribbon's tilted ellipse.
    val ta = if (faceOn) -camTilt else 0.55 + 0.3 * sin(t * 0.18) * spin
    val plane = BandPlane(t * 0.24 * spin, ta)

    // Radial lobes swell past the radius, so the base radius is pulled in by most of the wobble
    // amplitude: the silhouette stays inside the frame however far the deformation is pushed.
    val wobMul = o.opt("wobMul", 1.0)
    val baseR = if (faceOn) radius / (1 + 0.85 * 0.23 * wobMul) else radius

    val lanes = maxOf(1, roundHalfAway(o.opt("lanes", 5.0) * o.opt("bandMul", 1.0)).toInt())
    val segs = o.opt("segs", 88.0).toInt()
    val band = RibbonBand(into, pt, plane, t, faceOn, wobMul, baseR, radius, lanes, segs, o.opt("rBase", 1.1), o.opt("rDepth", 1.7), rs)
    for (w in 0 until lanes) band.lane(w)
    into.finish(o.opt("rMin", 0.3))
}
