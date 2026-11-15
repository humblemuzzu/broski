package com.muzammil.broski.feature.chat

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import com.muzammil.broski.feature.chat.composer.MAX_IMAGE_CHARS
import com.muzammil.broski.feature.chat.composer.MAX_SIDE
import java.io.File
import kotlin.random.Random
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A picked photo through the platform's own decoder and JPEG encoder: a 12-megapixel image of noise
 * (which compresses worst) is sent as a JPEG within the prompt's base64 bound, no side over
 * [MAX_SIDE], its proportions kept; a budget nothing fits leaves it out.
 */
class ImageAttachmentsTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val images = ImageAttachments(context.contentResolver)

    private fun noise(width: Int, height: Int): Uri {
        val random = Random(7)
        val bitmap = Bitmap.createBitmap(IntArray(width * height) { random.nextInt() or (0xFF shl 24) }, width, height, Bitmap.Config.ARGB_8888)
        val file = File(context.cacheDir, "noise-$width-$height.png")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return Uri.fromFile(file)
    }

    @Test
    fun aLargePhotoIsSentAsAJpegWithinTheBoundAtMostMaxSideWide() = runBlocking {
        val image = requireNotNull(images.read(noise(4_000, 3_000), MAX_IMAGE_CHARS))
        assertTrue("base64 ${image.base64.length} within the bound", image.base64.length <= MAX_IMAGE_CHARS)
        val bytes = Base64.decode(image.base64, Base64.NO_WRAP)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        assertEquals("image/jpeg", bounds.outMimeType)
        assertTrue("${bounds.outWidth} wide", bounds.outWidth <= MAX_SIDE)
        assertEquals(4f / 3f, bounds.outWidth.toFloat() / bounds.outHeight, 0.01f)
    }

    @Test
    fun anImageNothingLeftCanHoldIsLeftOut() = runBlocking {
        assertNull(images.read(noise(1_000, 1_000), budget = 1_000))
    }
}
