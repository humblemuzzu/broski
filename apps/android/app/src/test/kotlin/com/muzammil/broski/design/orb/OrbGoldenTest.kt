package com.muzammil.broski.design.orb

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * Holds the Kotlin engine to the numbers of ThinkingOrbs' reference engine (`orbs-golden.json`):
 * every state at both sizes at four instants, dot by dot and line by line.
 *
 * Dots are compared as a canonical multiset plus a far-to-near order check, not by array position.
 * `breathing` at 64 has an odd lane count, so its centre lane sits exactly on the view plane and
 * its z is a cancellation that comes out as ±1e-17 noise whose sign depends on each platform's
 * libm; engines then sort that tie group differently. Every dot in it has the same radius, ink
 * and alpha, so the order among them cannot change a pixel.
 */
class OrbGoldenTest {
    private val golden: JsonObject = checkNotNull(javaClass.classLoader?.getResourceAsStream("orbs-golden.json"))
        .use { Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject }
    private val tolerance = golden.getValue("tolerance").jsonPrimitive.double
    private val cases = golden.getValue("cases").jsonArray.map { it.jsonObject }

    private class Tally {
        var checked = 0
        val failures = mutableListOf<String>()

        fun compare(label: String, actual: Double, expected: Double, tolerance: Double) {
            checked++
            if (abs(actual - expected) > tolerance && failures.size < 25) {
                failures += "$label: got $actual, expected $expected"
            }
        }
    }

    private fun numbers(array: JsonArray): DoubleArray = DoubleArray(array.size) { array[it].jsonPrimitive.double }

    private fun q6(v: Double): Double = roundHalfAway(v * 1_000_000) / 1_000_000

    // Both sides are rounded to the golden file's precision before they are sorted, so that
    // near-duplicate values sort alike on either side.
    private fun sortedDots(count: Int, read: (Int) -> DoubleArray): List<DoubleArray> =
        List(count) { i -> read(i).also { row -> for (f in row.indices) row[f] = q6(row[f]) } }
            .sortedWith { a, b ->
                a.indices.firstNotNullOfOrNull { f -> a[f].compareTo(b[f]).takeIf { it != 0 } } ?: 0
            }

    private fun check(case: JsonObject, tally: Tally) {
        val key = case.getValue("key").jsonPrimitive.content
        val state = OrbState.valueOf(case.getValue("state").jsonPrimitive.content.uppercase())
        val size = OrbSize.valueOf("PX" + case.getValue("size").jsonPrimitive.int)
        val dotCount = case.getValue("dotCount").jsonPrimitive.int
        val lineCount = case.getValue("lineCount").jsonPrimitive.int
        val dots = numbers(case.getValue("dots").jsonArray)
        val lines = numbers(case.getValue("lines").jsonArray)

        val frame = orbFrame(state, size, case.getValue("t").jsonPrimitive.double)
        assertEquals("$key: dots", dotCount, frame.dotCount)
        assertEquals("$key: lines", lineCount, frame.lineCount)

        val mine = sortedDots(dotCount) { i ->
            doubleArrayOf(frame.x(i), frame.y(i), frame.z(i), frame.r(i), frame.white(i), frame.a(i))
        }
        val theirs = sortedDots(dotCount) { i -> dots.copyOfRange(i * 6, i * 6 + 6) }
        val fields = listOf("x", "y", "z", "r", "white", "a")
        for (i in 0 until dotCount) {
            for (f in 0 until 6) tally.compare("$key dot$i.${fields[f]}", mine[i][f], theirs[i][f], tolerance)
        }

        for (i in 1 until dotCount) {
            assertTrue("$key: dots not z-sorted at $i", frame.z(i) >= frame.z(i - 1))
        }
        val names = listOf("x1", "y1", "x2", "y2", "white", "a", "w")
        for (i in 0 until lineCount) {
            val actual = doubleArrayOf(
                frame.lineX1(i), frame.lineY1(i), frame.lineX2(i), frame.lineY2(i),
                frame.lineWhite(i), frame.lineA(i), frame.lineW(i),
            )
            for (f in 0 until 7) tally.compare("$key line$i.${names[f]}", actual[f], lines[i * 7 + f], tolerance)
        }
    }

    @Test
    fun matchesTheReferenceEngineOnEveryStateSizeAndInstant() {
        val tally = Tally()
        for (case in cases) check(case, tally)
        assertTrue(
            "${tally.failures.size} mismatch(es) of ${tally.checked} values:\n" + tally.failures.joinToString("\n"),
            tally.failures.isEmpty(),
        )
        println("golden: ${cases.size} cases, ${tally.checked} values within $tolerance (spec ${golden.getValue("specVersion").jsonPrimitive.content})")
    }

    @Test
    fun coversEveryStateAtBothSizes() {
        val keys = cases.map { it.getValue("state").jsonPrimitive.content + "-" + it.getValue("size").jsonPrimitive.int }.toSet()
        for (state in OrbState.entries) {
            for (size in OrbSize.entries) {
                assertTrue("$state at ${size.px}", state.name.lowercase() + "-" + size.px in keys)
            }
        }
    }

    @Test
    fun resolvesEachPresetToTheReferenceModeSpeedAndOptions() {
        val resolved = golden.getValue("resolved").jsonObject
        for ((key, value) in resolved) {
            val state = OrbState.valueOf(key.substringBeforeLast('-').uppercase())
            val size = OrbSize.valueOf("PX" + key.substringAfterLast('-'))
            val preset = resolvePreset(state, size)
            val expected = value.jsonObject
            assertEquals("$key: mode", expected.getValue("mode").jsonPrimitive.content.uppercase(), preset.mode.name)
            assertEquals("$key: speed", expected.getValue("speed").jsonPrimitive.double, preset.speed, tolerance)
            val opts = expected.getValue("opts").jsonObject
            assertEquals("$key: option names", opts.keys, preset.opts.keys)
            for ((name, v) in opts) assertEquals("$key: $name", v.jsonPrimitive.double, preset.opts.getValue(name), tolerance)
        }
    }

    @Test
    fun aReusedFrameHoldsExactlyWhatAFreshOneDoes() {
        val reused = OrbFrame()
        for (state in OrbState.entries) {
            val preset = resolvePreset(state, OrbSize.PX64)
            orbFrame(preset, 64.0, 3.3, reused)
            val fresh = orbFrame(preset, 64.0, 1.7)
            orbFrame(preset, 64.0, 1.7, reused)
            assertEquals("$state: dots", fresh.dotCount, reused.dotCount)
            assertEquals("$state: lines", fresh.lineCount, reused.lineCount)
            for (i in 0 until fresh.dotCount) {
                assertEquals("$state dot$i", fresh.x(i), reused.x(i), 0.0)
                assertEquals("$state dot$i", fresh.a(i), reused.a(i), 0.0)
            }
        }
    }

    @Test
    fun inkIsQuantisedToEightBitGreyAndMirroredOnDark() {
        assertEquals(0, inkGrey(0.0, dark = false))
        assertEquals(255, inkGrey(1.0, dark = false))
        assertEquals(255, inkGrey(0.0, dark = true))
        assertEquals(0, inkGrey(1.0, dark = true))
        assertEquals(128, inkGrey(0.5, dark = false))
        assertEquals(0, inkGrey(-3.0, dark = false))
        assertEquals(255, inkGrey(7.0, dark = false))
        assertEquals(inkGrey(0.3, dark = false), inkGrey(0.7, dark = true))
    }
}
