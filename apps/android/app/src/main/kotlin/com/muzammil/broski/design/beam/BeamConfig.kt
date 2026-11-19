package com.muzammil.broski.design.beam

/**
 * One of the three layers the rotate beam stacks, with everything about it that does not change from
 * frame to frame. [kind] is the shader's: 0 the stroke ring, 1 the inner glow, 2 the bloom ring.
 * [blobs] are 8 floats each (rx, ry, centre x and y as fractions of the element, r, g, b, a); [bg] and
 * [maskStops] are `[position 0..1, alpha]` pairs, [bg] the conic gradient over the blobs and
 * [maskStops] the conic window, either empty for none.
 */
class BeamLayer(
    val kind: Int,
    val edgeMaskPx: Double,
    val blobs: FloatArray,
    val bg: FloatArray,
    val bgIsBlack: Boolean,
    val maskStops: FloatArray,
    val opacity: Double,
    val shadow: BeamRgba,
    val shadowBlur: Double,
) {
    companion object {
        const val STROKE = 0
        const val INNER = 1
        const val BLOOM = 2
    }
}

/**
 * A beam resolved from the spec for one size, variant, theme and strength: BorderBeamKit's
 * `RotateBeamConfig`. Built when those change; a frame then varies only the angle, the hue-shift matrix
 * and the fade.
 */
class BeamConfig(
    spec: BeamSpec,
    size: BeamSize,
    variant: BeamColorVariant,
    val dark: Boolean,
    val cornerRadius: Double,
    strength: Double,
) {
    private val theme = if (dark) "dark" else "light"
    private val colors = checkNotNull(spec.sizeThemePresets[size.key]?.get(theme)) { "no ${size.key} $theme preset" }
    private val rotate = spec.rotate
    val borderWidth = checkNotNull(spec.sizePresets[size.key]) { "no ${size.key} size preset" }.borderWidth
    val duration = spec.defaults.duration.rotate
    val hueRange = spec.defaults.hueRange
    val hueShiftPeriod = spec.defaults.rotateHueShiftPeriod
    val fadeInSeconds = spec.defaults.fadeInSeconds
    val fadeOutSeconds = spec.defaults.fadeOutSeconds
    val bloomBlurPx = rotate.bloomBlurPx

    /** Mono holds its colours still, as the web library does. */
    val staticColors = variant == BeamColorVariant.MONO
    val brightness = colors.brightness ?: spec.defaults.brightnessFallback
    val saturation = colors.saturation
    private val clampedStrength = strength.coerceIn(0.0, 1.0)
    private val monoMultiplier = if (variant == BeamColorVariant.MONO) spec.defaults.monoOpacityMultiplier else 1.0

    val inner = BeamLayer(
        kind = BeamLayer.INNER,
        edgeMaskPx = if (size == BeamSize.MD) rotate.innerEdgeMaskPx else 0.0,
        blobs = innerBlobs(spec, size, variant),
        bg = FloatArray(0),
        bgIsBlack = false,
        maskStops = flattenStops(if (size == BeamSize.SM) rotate.smallMaskStops else rotate.beamMaskStops),
        opacity = colors.innerOpacity,
        shadow = BeamRgba.parse(colors.innerShadow) ?: BeamRgba.Clear,
        shadowBlur = if (size == BeamSize.SM) rotate.innerShadowBlur.sm else rotate.innerShadowBlur.md,
    )

    val stroke = BeamLayer(
        kind = BeamLayer.STROKE,
        edgeMaskPx = 0.0,
        blobs = blobFloats(strokeBlobs(spec, size, variant)),
        bg = flattenStops(checkNotNull(rotate.whiteGradientStops[theme])),
        bgIsBlack = !dark,
        maskStops = flattenStops(rotate.beamMaskStops),
        opacity = colors.strokeOpacity,
        shadow = BeamRgba.Clear,
        shadowBlur = 0.0,
    )

    val bloom = BeamLayer(
        kind = BeamLayer.BLOOM,
        edgeMaskPx = 0.0,
        blobs = FloatArray(0),
        bg = flattenStops(checkNotNull(rotate.bloomGradientStops[theme])),
        bgIsBlack = !dark,
        maskStops = FloatArray(0),
        opacity = colors.bloomOpacity,
        shadow = BeamRgba.Clear,
        shadowBlur = 0.0,
    )

    /** The bloom's filter has no hue rotation on the web: its brightness and saturation are static. */
    val bloomMatrix = FloatArray(BeamColorMatrix.SIZE).also { BeamColorMatrix.composed(0.0, brightness, saturation, it) }

    /** The stroke and inner layers' filter at [seconds]; with static colours the web applies none. */
    fun filterMatrixInto(out: FloatArray, seconds: Double, scratch: BeamColorMatrix.Scratch) {
        if (staticColors) {
            IDENTITY.copyInto(out)
        } else {
            val hue = BeamMotion.hueShiftDegrees(seconds, hueRange, hueShiftPeriod, staticColors)
            BeamColorMatrix.composed(hue, brightness, saturation, out, scratch)
        }
    }

    fun angle(seconds: Double): Double = BeamMotion.beamAngle(seconds, duration)

    /** The opacity every layer shares at [fade]; each layer multiplies in its own. */
    fun baseOpacity(fade: Double): Double = fade * clampedStrength * monoMultiplier

    private companion object {
        val IDENTITY = BeamColorMatrix.identity()
    }
}

private fun strokeBlobs(spec: BeamSpec, size: BeamSize, variant: BeamColorVariant): List<BeamSpec.GradientBlob> = when (size) {
    BeamSize.SM -> checkNotNull(spec.palettes.small[variant.key]) { "no small ${variant.key} palette" }.border
    BeamSize.MD -> checkNotNull(spec.palettes.border[variant.key]) { "no ${variant.key} palette" }.border
}

/** The inner layer's blobs: SM has its own palette, MD derives from the border palette at 0.9 the size and a fixed alpha. */
private fun innerBlobs(spec: BeamSpec, size: BeamSize, variant: BeamColorVariant): FloatArray = when (size) {
    BeamSize.SM -> blobFloats(checkNotNull(spec.palettes.small[variant.key]) { "no small ${variant.key} palette" }.inner)
    BeamSize.MD -> {
        val derivation = spec.rotate.innerGradientDerivation
        val alpha = if (variant == BeamColorVariant.MONO) derivation.monoAlpha else derivation.alpha
        blobFloats(strokeBlobs(spec, size, variant), derivation.sizeScale, alpha)
    }
}

/** Blobs as 8 floats each; a blob whose colour does not parse is left out. */
internal fun blobFloats(blobs: List<BeamSpec.GradientBlob>, sizeScale: Double = 1.0, alphaOverride: Double? = null): FloatArray {
    val out = ArrayList<Float>(blobs.size * BLOB_FLOATS)
    for (blob in blobs) {
        val color = BeamRgba.parse(blob.color) ?: continue
        val (x, y) = parsePercentPair(blob.pos)
        val (width, height) = parsePixelPair(blob.size)
        // The web rounds the scaled radii to whole pixels.
        val rx = if (sizeScale == 1.0) width else Math.round(width * sizeScale).toDouble()
        val ry = if (sizeScale == 1.0) height else Math.round(height * sizeScale).toDouble()
        val a = alphaOverride ?: color.a
        for (value in doubleArrayOf(rx, ry, x, y, color.r, color.g, color.b, a)) out.add(value.toFloat())
    }
    return out.toFloatArray()
}

internal fun flattenStops(stops: List<List<Double>>): FloatArray {
    val out = FloatArray(stops.size * 2)
    stops.forEachIndexed { i, stop ->
        out[2 * i] = (stop[0] / 100).toFloat()
        out[2 * i + 1] = stop[1].toFloat()
    }
    return out
}

internal const val BLOB_FLOATS = 8
