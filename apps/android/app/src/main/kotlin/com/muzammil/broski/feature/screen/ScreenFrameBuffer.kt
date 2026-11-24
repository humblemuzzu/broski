package com.muzammil.broski.feature.screen

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** Backing RGBA→ARGB bitmap buffer for [ScreenViewModel]. Must be mutated on the main thread. */
internal class ScreenFrameBuffer {
    private var bitmap: Bitmap? = null
    private var imageBitmap: ImageBitmap? = null

    fun ensure(width: Int, height: Int): Pair<Bitmap, ImageBitmap>? {
        if (width <= 0 || height <= 0) return null
        val existing = bitmap
        val existingImg = imageBitmap
        if (existing != null && existingImg != null && existing.width == width && existing.height == height) {
            return existing to existingImg
        }
        existing?.recycle()
        val fresh = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val freshImg = fresh.asImageBitmap()
        bitmap = fresh
        imageBitmap = freshImg
        return fresh to freshImg
    }

    fun applyRect(width: Int, height: Int, x: Int, y: Int, rectWidth: Int, rectHeight: Int, pixels: IntArray): ImageBitmap? {
        val (bmp, img) = ensure(width, height) ?: return null
        if (x >= 0 && y >= 0 && x + rectWidth <= bmp.width && y + rectHeight <= bmp.height) {
            bmp.setPixels(pixels, 0, rectWidth, x, y, rectWidth, rectHeight)
        }
        return img
    }

    fun recycle() {
        imageBitmap = null
        bitmap?.recycle()
        bitmap = null
    }

    companion object {
        fun decodeRgbaToArgb(w: Int, h: Int, rgba: ByteArray): IntArray? {
            if (w <= 0 || h <= 0 || rgba.size < w * h * 4) return null
            val pixels = IntArray(w * h)
            var offset = 0
            for (i in pixels.indices) {
                val r = rgba[offset].toInt() and 0xff
                val g = rgba[offset + 1].toInt() and 0xff
                val b = rgba[offset + 2].toInt() and 0xff
                val a = rgba[offset + 3].toInt() and 0xff
                pixels[i] = Color.argb(a, r, g, b)
                offset += 4
            }
            return pixels
        }

        fun cursorBitmap(width: Int, height: Int, rgba: ByteArray): ImageBitmap? {
            val pixels = decodeRgbaToArgb(width, height, rgba) ?: return null
            return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bmp ->
                bmp.setPixels(pixels, 0, width, 0, 0, width, height)
            }.asImageBitmap()
        }
    }
}
