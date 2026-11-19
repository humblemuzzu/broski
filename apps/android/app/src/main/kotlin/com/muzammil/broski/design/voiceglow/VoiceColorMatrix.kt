package com.muzammil.broski.design.voiceglow

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * `hue-rotate(θ) brightness(b) saturate(s)` as one row-major 3×3 matrix, from the W3C Filter
 * Effects spec (what browsers run, not a true HSL rotation). The web glow applies the chain as a CSS
 * filter on each layer; it is linear, so applying it to each lobe colour up front draws the same
 * picture.
 */
internal object VoiceColorMatrix {
    /** Writes the matrix to [out]; [scratch] holds the two factors, 18 doubles. */
    fun compose(out: DoubleArray, scratch: DoubleArray, hueDegrees: Double, brightness: Double, saturation: Double) {
        val rad = hueDegrees * PI / 180
        val c = cos(rad)
        val s = sin(rad)
        scratch[0] = (0.213 + c * 0.787 - s * 0.213) * brightness
        scratch[1] = (0.715 - c * 0.715 - s * 0.715) * brightness
        scratch[2] = (0.072 - c * 0.072 + s * 0.928) * brightness
        scratch[3] = (0.213 - c * 0.213 + s * 0.143) * brightness
        scratch[4] = (0.715 + c * 0.285 + s * 0.140) * brightness
        scratch[5] = (0.072 - c * 0.072 - s * 0.283) * brightness
        scratch[6] = (0.213 - c * 0.213 - s * 0.787) * brightness
        scratch[7] = (0.715 - c * 0.715 + s * 0.715) * brightness
        scratch[8] = (0.072 + c * 0.928 + s * 0.072) * brightness
        scratch[9] = 0.213 + 0.787 * saturation
        scratch[10] = 0.715 - 0.715 * saturation
        scratch[11] = 0.072 - 0.072 * saturation
        scratch[12] = 0.213 - 0.213 * saturation
        scratch[13] = 0.715 + 0.285 * saturation
        scratch[14] = 0.072 - 0.072 * saturation
        scratch[15] = 0.213 - 0.213 * saturation
        scratch[16] = 0.715 - 0.715 * saturation
        scratch[17] = 0.072 + 0.928 * saturation
        for (row in 0 until 3) {
            for (col in 0 until 3) {
                var sum = 0.0
                for (k in 0 until 3) sum += scratch[9 + row * 3 + k] * scratch[k * 3 + col]
                out[row * 3 + col] = sum
            }
        }
    }

    /** Applies [m] to a packed `0xRRGGBB` colour and writes 0–1 components to `out[at..at+2]`, clamped as the browser clamps after the chain. */
    fun apply(m: DoubleArray, rgb: Int, out: FloatArray, at: Int) {
        apply(m, ((rgb shr 16) and 0xFF).toDouble(), ((rgb shr 8) and 0xFF).toDouble(), (rgb and 0xFF).toDouble(), out, at)
    }

    fun apply(m: DoubleArray, r255: Double, g255: Double, b255: Double, out: FloatArray, at: Int) {
        val r = r255 / 255
        val g = g255 / 255
        val b = b255 / 255
        out[at] = (m[0] * r + m[1] * g + m[2] * b).coerceIn(0.0, 1.0).toFloat()
        out[at + 1] = (m[3] * r + m[4] * g + m[5] * b).coerceIn(0.0, 1.0).toFloat()
        out[at + 2] = (m[6] * r + m[7] * g + m[8] * b).coerceIn(0.0, 1.0).toFloat()
    }
}
