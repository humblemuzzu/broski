package com.muzammil.broski.design.orb

/** A (state, size) pair resolved to its mode, speed and fully scaled draw options. */
class ResolvedPreset internal constructor(
    internal val mode: OrbMode,
    val speed: Double,
    internal val opts: Map<String, Double>,
)

private fun scaleCounts(opts: Map<String, Double>, scale: Double): MutableMap<String, Double> {
    val out = opts.toMutableMap()
    val done = HashSet<String>()
    val rt = Math.sqrt(scale)
    for ((a, b) in OrbSpec.countPairs) {
        val va = out[a]
        val vb = out[b]
        if (va != null && vb != null && a !in done && b !in done) {
            out[a] = maxOf(2.0, roundHalfAway(va * rt))
            out[b] = maxOf(2.0, roundHalfAway(vb * rt))
            done += a
            done += b
        }
    }
    for (k in OrbSpec.countKeys) {
        // 0 means the mode opted out of that layer (ring has no ghost sphere); scaling must not
        // bring it back as a single stray dot
        val v = out[k]
        if (v != null && v != 0.0 && k !in done) out[k] = maxOf(1.0, roundHalfAway(v * scale))
    }
    for (k in OrbSpec.iconDensityKeys) {
        val v = out[k]
        if (v != null) out[k] = maxOf(0.02, v * scale)
    }
    return out
}

private fun scaleRadii(opts: Map<String, Double>, scale: Double): MutableMap<String, Double> {
    val out = opts.toMutableMap()
    for (k in OrbSpec.radiusKeys) {
        val v = out[k]
        if (v != null) out[k] = v * scale
    }
    out["rSizeMul"] = (out["rSizeMul"] ?: 1.0) * scale
    return out
}

private fun resolve(state: OrbState, size: OrbSize): ResolvedPreset {
    val mode = state.mode
    val preset = checkNotNull(OrbSpec.presets[mode]?.get(size))
    var opts: Map<String, Double> = checkNotNull(OrbSpec.baseProfiles[mode])
    if (preset.count != 1.0) opts = scaleCounts(opts, preset.count)
    if (preset.size != 1.0) opts = scaleRadii(opts, preset.size)
    if (preset.extra.isNotEmpty()) opts = opts + preset.extra
    return ResolvedPreset(mode, preset.speed, opts)
}

private val resolved: Array<ResolvedPreset> =
    Array(OrbState.entries.size * OrbSize.entries.size) { i ->
        resolve(OrbState.entries[i / OrbSize.entries.size], OrbSize.entries[i % OrbSize.entries.size])
    }

fun resolvePreset(state: OrbState, size: OrbSize): ResolvedPreset =
    resolved[state.ordinal * OrbSize.entries.size + size.ordinal]

/** The geometry of one instant, written into [into] (a fresh frame by default). */
fun orbFrame(preset: ResolvedPreset, size: Double, t: Double, into: OrbFrame = OrbFrame()): OrbFrame {
    into.reset()
    val o = preset.opts
    when (preset.mode) {
        OrbMode.ORBITS -> frameOrbits(into, size, t, o)
        OrbMode.GLOBE -> frameGlobe(into, size, t, o)
        OrbMode.RUBIK -> frameRubik(into, size, t, o)
        OrbMode.WAVE -> frameWave(into, size, t, o)
        OrbMode.WEB -> frameWeb(into, size, t, o)
        OrbMode.BRAID -> frameBraid(into, size, t, o)
        // ring shares ribbon's geometry; the `faceOn` profile flag switches it
        OrbMode.RIBBON, OrbMode.RING -> frameRibbon(into, size, t, o)
        OrbMode.MORPH -> frameMorph(into, size, t, o)
    }
    return into
}

fun orbFrame(state: OrbState, size: OrbSize, t: Double): OrbFrame =
    orbFrame(resolvePreset(state, size), size.px.toDouble(), t)

internal fun Map<String, Double>.opt(key: String, default: Double): Double = this[key] ?: default
