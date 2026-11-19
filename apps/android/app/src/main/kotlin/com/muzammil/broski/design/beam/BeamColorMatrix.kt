package com.muzammil.broski.design.beam

import kotlin.math.cos
import kotlin.math.sin

/**
 * The 3x3 matrix of the CSS filter chain `hue-rotate(θ) brightness(b) saturate(s)`, applied left to
 * right, so the composed matrix is `Msaturate × (b · Mhue)`. These are the W3C feColorMatrix forms
 * browsers use, not an HSL rotation, which keeps the colours equal to the web library's. Matrices are
 * row-major.
 */
object BeamColorMatrix {
    const val SIZE = 9

    fun hueRotate(degrees: Double, out: DoubleArray = DoubleArray(SIZE)): DoubleArray {
        val rad = degrees * Math.PI / 180
        val c = cos(rad)
        val s = sin(rad)
        out[0] = 0.213 + c * 0.787 - s * 0.213
        out[1] = 0.715 - c * 0.715 - s * 0.715
        out[2] = 0.072 - c * 0.072 + s * 0.928
        out[3] = 0.213 - c * 0.213 + s * 0.143
        out[4] = 0.715 + c * 0.285 + s * 0.140
        out[5] = 0.072 - c * 0.072 - s * 0.283
        out[6] = 0.213 - c * 0.213 - s * 0.787
        out[7] = 0.715 - c * 0.715 + s * 0.715
        out[8] = 0.072 + c * 0.928 + s * 0.072
        return out
    }

    fun saturate(amount: Double, out: DoubleArray = DoubleArray(SIZE)): DoubleArray {
        out[0] = 0.213 + 0.787 * amount
        out[1] = 0.715 - 0.715 * amount
        out[2] = 0.072 - 0.072 * amount
        out[3] = 0.213 - 0.213 * amount
        out[4] = 0.715 + 0.285 * amount
        out[5] = 0.072 - 0.072 * amount
        out[6] = 0.213 - 0.213 * amount
        out[7] = 0.715 - 0.715 * amount
        out[8] = 0.072 + 0.928 * amount
        return out
    }

    fun multiply(a: DoubleArray, b: DoubleArray, out: DoubleArray = DoubleArray(SIZE)): DoubleArray {
        for (row in 0 until 3) {
            for (col in 0 until 3) {
                var sum = 0.0
                for (k in 0 until 3) sum += a[row * 3 + k] * b[k * 3 + col]
                out[row * 3 + col] = sum
            }
        }
        return out
    }

    /** The matrices a frame composes in, kept so a frame allocates nothing. */
    class Scratch {
        internal val hue = DoubleArray(SIZE)
        internal val saturation = DoubleArray(SIZE)
        internal val product = DoubleArray(SIZE)
    }

    /** `hue-rotate(hueDegrees) brightness(brightness) saturate(saturation)` into [out], as the shader reads it. */
    fun composed(hueDegrees: Double, brightness: Double, saturation: Double, out: FloatArray, scratch: Scratch = Scratch()) {
        hueRotate(hueDegrees, scratch.hue)
        for (i in 0 until SIZE) scratch.hue[i] *= brightness
        saturate(saturation, scratch.saturation)
        multiply(scratch.saturation, scratch.hue, scratch.product)
        for (i in 0 until SIZE) out[i] = scratch.product[i].toFloat()
    }

    fun identity(): FloatArray = floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f)
}
