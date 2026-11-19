package com.muzammil.broski.design.beam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the JVM can say about the shader without a GPU: that its uniforms are the ones the painter sets. */
class BeamAgslTest {
    private val declared = Regex("""uniform\s+\w+\s+(\w+)""").findAll(BeamAgslSource).map { it.groupValues[1] }.toSet()

    @Test
    fun theShaderDeclaresExactlyTheUniformsThePainterSets() {
        val names = BeamUniform::class.java.declaredFields
            .filter { java.lang.reflect.Modifier.isStatic(it.modifiers) && it.type == String::class.java }
            .map { it.isAccessible = true; it.get(null) as String }
            .toSet()
        assertEquals(names, declared)
    }

    @Test
    fun theUniformArraysHoldTheLimitsTheConfigIsCheckedAgainst() {
        assertTrue(BeamAgslSource.contains("uniform float blobs[${BeamLimits.BLOBS * BLOB_FLOATS}];"))
        assertTrue(BeamAgslSource.contains("uniform float bg[${BeamLimits.STOPS * 2}];"))
        assertTrue(BeamAgslSource.contains("uniform float maskStops[${BeamLimits.STOPS * 2}];"))
        assertTrue(BeamAgslSource.contains("uniform float cm[${BeamColorMatrix.SIZE}];"))
    }

    @Test
    fun theSourceIsFullyInterpolated() {
        assertTrue(!BeamAgslSource.contains("\${"))
        assertTrue(BeamAgslSource.contains("half4 main(float2 fragCoord)"))
    }
}
