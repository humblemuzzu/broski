package com.muzammil.broski.design.beam

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/**
 * The rotate family's part of border-beam's `beam-spec.json` (the platform-neutral spec its web library
 * generates). Every palette, preset and timing the beam draws comes from it; nothing visual is
 * hard-coded in Kotlin. Stop lists are `[position %, alpha]` pairs.
 */
@Serializable
data class BeamSpec(
    val defaults: Defaults,
    val sizePresets: Map<String, SizeConfig>,
    val sizeThemePresets: Map<String, Map<String, ThemeColors>>,
    val palettes: Palettes,
    val rotate: Rotate,
) {
    @Serializable
    data class Defaults(
        val duration: Durations,
        val hueRange: Double,
        val brightnessFallback: Double,
        val fadeInSeconds: Double,
        val fadeOutSeconds: Double,
        val rotateHueShiftPeriod: Double,
        val monoOpacityMultiplier: Double,
    )

    @Serializable
    data class Durations(val rotate: Double)

    @Serializable
    data class SizeConfig(val borderRadius: Double, val borderWidth: Double)

    @Serializable
    data class ThemeColors(
        val strokeOpacity: Double,
        val innerOpacity: Double,
        val bloomOpacity: Double,
        /** A CSS colour string such as `rgba(255, 255, 255, 0.27)`, or `transparent`. */
        val innerShadow: String,
        val saturation: Double,
        val brightness: Double? = null,
    )

    /** [pos] is `"x% y%"` of the element, [size] the ellipse radii as `"Wpx Hpx"`. */
    @Serializable
    data class GradientBlob(val color: String, val pos: String, val size: String)

    @Serializable
    data class BorderPalette(val border: List<GradientBlob>)

    @Serializable
    data class SmallPalette(val border: List<GradientBlob>, val inner: List<GradientBlob>)

    @Serializable
    data class Palettes(
        val border: Map<String, BorderPalette>,
        val small: Map<String, SmallPalette>,
    )

    @Serializable
    data class InnerGradientDerivation(val sizeScale: Double, val alpha: Double, val monoAlpha: Double)

    @Serializable
    data class InnerShadowBlur(val md: Double, val sm: Double)

    @Serializable
    data class Rotate(
        val whiteGradientStops: Map<String, List<List<Double>>>,
        val bloomGradientStops: Map<String, List<List<Double>>>,
        val beamMaskStops: List<List<Double>>,
        val smallMaskStops: List<List<Double>>,
        val innerGradientDerivation: InnerGradientDerivation,
        val innerEdgeMaskPx: Double,
        val innerShadowBlur: InnerShadowBlur,
        val bloomBlurPx: Double,
    )

    companion object {
        private val codec = Json { ignoreUnknownKeys = true }

        /** The spec in [json]; a [SerializationException] when it is not one. */
        fun parse(json: String): BeamSpec = codec.decodeFromString(serializer(), json)
    }
}
