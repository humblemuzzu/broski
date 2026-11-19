package com.muzammil.broski.design.beam

/** A colour read from the spec's CSS strings, channels 0..1. */
data class BeamRgba(val r: Double, val g: Double, val b: Double, val a: Double) {
    companion object {
        val Clear = BeamRgba(0.0, 0.0, 0.0, 0.0)

        /** `rgb(r, g, b)`, `rgba(r, g, b, a)` or `transparent`; null for anything else. */
        fun parse(css: String): BeamRgba? {
            val text = css.trim()
            if (text == "transparent") return Clear
            if (!text.startsWith("rgb")) return null
            val numbers = text.substringAfter('(').dropLast(1).split(',').mapNotNull { it.trim().toDoubleOrNull() }
            if (numbers.size < 3) return null
            return BeamRgba(numbers[0] / 255, numbers[1] / 255, numbers[2] / 255, numbers.getOrElse(3) { 1.0 })
        }
    }
}

/** `"33% -7.4%"` as (0.33, -0.074); (0, 0) when it is not a pair. */
fun parsePercentPair(value: String): Pair<Double, Double> = parsePair(value, "%", 100.0)

/** `"70px 40px"` as (70, 40); (0, 0) when it is not a pair. */
fun parsePixelPair(value: String): Pair<Double, Double> = parsePair(value, "px", 1.0)

private fun parsePair(value: String, suffix: String, divisor: Double): Pair<Double, Double> {
    val parts = value.split(' ').filter { it.isNotEmpty() }
    if (parts.size != 2) return 0.0 to 0.0
    fun number(part: String) = (part.replace(suffix, "").toDoubleOrNull() ?: 0.0) / divisor
    return number(parts[0]) to number(parts[1])
}
