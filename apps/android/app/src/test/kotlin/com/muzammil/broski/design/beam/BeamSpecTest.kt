package com.muzammil.broski.design.beam

import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shipped `beam-spec.json` against everything BorderBeamKit's rotate family reads from it. */
class BeamSpecTest {
    private val spec = BeamSpec.parse(File("src/main/assets/beam-spec.json").readText())

    @Test
    fun theDefaultsAreTheWebLibrarys() {
        val defaults = spec.defaults
        assertEquals(1.96, defaults.duration.rotate, 0.0)
        assertEquals(30.0, defaults.hueRange, 0.0)
        assertEquals(1.3, defaults.brightnessFallback, 0.0)
        assertEquals(0.6, defaults.fadeInSeconds, 0.0)
        assertEquals(0.5, defaults.fadeOutSeconds, 0.0)
        assertEquals(12.0, defaults.rotateHueShiftPeriod, 0.0)
        assertEquals(0.5, defaults.monoOpacityMultiplier, 0.0)
    }

    @Test
    fun everySizeHasItsPresetAndBothThemes() {
        for (size in BeamSize.entries) {
            assertNotNull("size preset ${size.key}", spec.sizePresets[size.key])
            for (theme in listOf("dark", "light")) {
                assertNotNull("${size.key} $theme", spec.sizeThemePresets[size.key]?.get(theme))
                assertNotNull("white stops $theme", spec.rotate.whiteGradientStops[theme])
                assertNotNull("bloom stops $theme", spec.rotate.bloomGradientStops[theme])
            }
        }
        assertEquals(1.0, spec.sizePresets.getValue("md").borderWidth, 0.0)
        assertEquals(32.0, spec.sizePresets.getValue("sm").borderRadius, 0.0)
        val md = spec.sizeThemePresets.getValue("md")
        assertEquals(0.26, md.getValue("dark").strokeOpacity, 0.0)
        assertEquals(0.42, md.getValue("dark").innerOpacity, 0.0)
        assertEquals(0.24, md.getValue("dark").bloomOpacity, 0.0)
        assertEquals(1.2, md.getValue("dark").saturation, 0.0)
        assertEquals(1.5, md.getValue("light").saturation, 0.0)
        assertEquals("rgba(255, 255, 255, 0.27)", md.getValue("dark").innerShadow)
    }

    @Test
    fun everyVariantHasItsBorderAndSmallPalettes() {
        for (variant in BeamColorVariant.entries) {
            val border = spec.palettes.border.getValue(variant.key).border
            val small = spec.palettes.small.getValue(variant.key)
            assertEquals(9, border.size)
            assertEquals(8, small.border.size)
            assertEquals(8, small.inner.size)
        }
        assertEquals(
            BeamSpec.GradientBlob("rgb(255, 50, 100)", "33% -7.4%", "70px 40px"),
            spec.palettes.border.getValue("colorful").border.first(),
        )
    }

    @Test
    fun theRotateTablesAreComplete() {
        val rotate = spec.rotate
        assertEquals(11, rotate.whiteGradientStops.getValue("dark").size)
        assertEquals(13, rotate.bloomGradientStops.getValue("light").size)
        assertEquals(10, rotate.beamMaskStops.size)
        assertEquals(10, rotate.smallMaskStops.size)
        assertEquals(listOf(66.0, 0.75), rotate.whiteGradientStops.getValue("dark")[5])
        assertEquals(0.9, rotate.innerGradientDerivation.sizeScale, 0.0)
        assertEquals(0.45, rotate.innerGradientDerivation.alpha, 0.0)
        assertEquals(0.225, rotate.innerGradientDerivation.monoAlpha, 0.0)
        assertEquals(28.0, rotate.innerEdgeMaskPx, 0.0)
        assertEquals(9.0, rotate.innerShadowBlur.md, 0.0)
        assertEquals(5.0, rotate.innerShadowBlur.sm, 0.0)
        assertEquals(8.0, rotate.bloomBlurPx, 0.0)
    }

    @Test
    fun everySizeThemeAndVariantResolvesAndFitsTheShader() {
        for (size in BeamSize.entries) for (variant in BeamColorVariant.entries) for (dark in listOf(true, false)) {
            val config = BeamConfig(spec, size, variant, dark, 28.0, 1.0)
            for (layer in listOf(config.inner, config.stroke, config.bloom)) {
                assertTrue(layer.blobs.size / BLOB_FLOATS <= BeamLimits.BLOBS)
                assertTrue(layer.bg.size / 2 <= BeamLimits.STOPS)
                assertTrue(layer.maskStops.size / 2 <= BeamLimits.STOPS)
            }
            assertEquals(variant == BeamColorVariant.MONO, config.staticColors)
        }
    }

    @Test
    fun mdLayersAreBuiltAsTheIosConfigBuildsThem() {
        val config = BeamConfig(spec, BeamSize.MD, BeamColorVariant.COLORFUL, dark = true, cornerRadius = 26.0, strength = 1.0)
        assertArrayEquals(
            floatArrayOf(70f, 40f, 0.33f, -0.074f, 1f, 50f / 255, 100f / 255, 1f),
            config.stroke.blobs.copyOfRange(0, 8),
            1e-6f,
        )
        assertArrayEquals(
            floatArrayOf(63f, 36f, 0.33f, -0.074f, 1f, 50f / 255, 100f / 255, 0.45f),
            config.inner.blobs.copyOfRange(0, 8),
            1e-6f,
        )
        assertEquals(9, config.stroke.blobs.size / BLOB_FLOATS)
        assertEquals(BeamLayer.STROKE, config.stroke.kind)
        assertEquals(BeamLayer.INNER, config.inner.kind)
        assertEquals(BeamLayer.BLOOM, config.bloom.kind)
        assertEquals(28.0, config.inner.edgeMaskPx, 0.0)
        assertEquals(9.0, config.inner.shadowBlur, 0.0)
        assertEquals(BeamRgba(1.0, 1.0, 1.0, 0.27), config.inner.shadow)
        assertEquals(0.42, config.inner.opacity, 0.0)
        assertEquals(0.26, config.stroke.opacity, 0.0)
        assertEquals(0.24, config.bloom.opacity, 0.0)
        assertEquals(false, config.stroke.bgIsBlack)
        assertEquals(22, config.stroke.bg.size)
        assertEquals(26, config.bloom.bg.size)
        assertEquals(20, config.stroke.maskStops.size)
        assertEquals(0, config.bloom.maskStops.size)
        assertEquals(0.54f, config.stroke.bg[2 * 1], 1e-6f)
        assertEquals(1.3, config.brightness, 0.0)
    }

    @Test
    fun smHasItsOwnInnerPaletteMaskAndNoEdgeFade() {
        val config = BeamConfig(spec, BeamSize.SM, BeamColorVariant.MONO, dark = false, cornerRadius = 32.0, strength = 1.0)
        assertEquals(8, config.inner.blobs.size / BLOB_FLOATS)
        assertEquals(0.25f, config.inner.blobs[7], 1e-6f)
        assertEquals(0.0, config.inner.edgeMaskPx, 0.0)
        assertEquals(5.0, config.inner.shadowBlur, 0.0)
        assertEquals(0.22f, config.inner.maskStops[2 * 1 + 0], 1e-6f)
        assertEquals(true, config.stroke.bgIsBlack)
        assertEquals(BeamRgba(0.0, 0.0, 0.0, 0.14), config.inner.shadow)
    }

    @Test
    fun monoHalvesTheOpacityAndStrengthScalesAndClampsIt() {
        val mono = BeamConfig(spec, BeamSize.MD, BeamColorVariant.MONO, true, 26.0, 1.0)
        assertEquals(0.5, mono.baseOpacity(1.0), 0.0)
        assertEquals(0.225f, mono.inner.blobs[7], 1e-6f)
        val half = BeamConfig(spec, BeamSize.MD, BeamColorVariant.OCEAN, true, 26.0, 0.5)
        assertEquals(0.25, half.baseOpacity(0.5), 1e-12)
        assertEquals(1.0, BeamConfig(spec, BeamSize.MD, BeamColorVariant.OCEAN, true, 26.0, 7.0).baseOpacity(1.0), 0.0)
        assertEquals(0.0, BeamConfig(spec, BeamSize.MD, BeamColorVariant.OCEAN, true, 26.0, -1.0).baseOpacity(1.0), 0.0)
    }

    @Test
    fun cssColoursParseTheWayTheIosParserDoes() {
        assertEquals(BeamRgba(1.0, 0.0, 0.0, 1.0), BeamRgba.parse("rgb(255, 0, 0)"))
        assertEquals(BeamRgba(0.0, 0.0, 0.0, 0.14), BeamRgba.parse(" rgba(0, 0, 0, 0.14) "))
        assertEquals(BeamRgba.Clear, BeamRgba.parse("transparent"))
        assertNull(BeamRgba.parse("#fff"))
        assertNull(BeamRgba.parse("rgb(1, 2)"))
        val (x, y) = parsePercentPair("33% -7.4%")
        assertEquals(0.33, x, 1e-12)
        assertEquals(-0.074, y, 1e-12)
        assertEquals(70.0 to 40.0, parsePixelPair("70px 40px"))
        assertEquals(0.0 to 0.0, parsePixelPair("70px"))
    }
}
