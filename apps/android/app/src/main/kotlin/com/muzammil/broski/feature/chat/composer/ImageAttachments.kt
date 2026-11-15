package com.muzammil.broski.feature.chat.composer

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.broski_contract.Attachment
import uniffi.broski_contract.ImageContent

/** An image waiting in the composer: what is sent, and the thumbnail its strip shows. */
@Immutable
class ComposerImage(val id: String, val base64: String, val thumbnail: ImageBitmap) {
    fun attachment(): Attachment = Attachment.Image(ImageContent(mimeType = "image/jpeg", data = base64, name = null))
}

/**
 * Reads a picked, photographed or pasted image and fits it to what a prompt may carry: JPEG, at
 * most [MAX_SIDE] on its longest side, within the base64 the prompt's other images leave.
 */
class ImageAttachments(private val resolver: ContentResolver) {
    /** The image at [uri] within [budget] base64 characters; `null` when it does not decode or cannot fit. */
    suspend fun read(uri: Uri, budget: Int): ComposerImage? = withContext(Dispatchers.Default) {
        val source = try {
            decode(uri)
        } catch (_: IOException) {
            null
        } ?: return@withContext null
        val bytes = fitImage(source.width, source.height, budget) { width, height, quality ->
            val scaled = Bitmap.createScaledBitmap(source, width, height, true)
            ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
        } ?: return@withContext null
        val (thumbWidth, thumbHeight) = thumbnailSize(source.width, source.height)
        ComposerImage(
            id = UUID.randomUUID().toString(),
            base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            thumbnail = Bitmap.createScaledBitmap(source, thumbWidth, thumbHeight, true).asImageBitmap(),
        )
    }

    /** Upright on Android 9 and later, which reads a photo's orientation; below it, as stored. */
    private fun decode(uri: Uri): Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val (width, height) = startSize(info.size.width, info.size.height)
            decoder.setTargetSize(width, height)
        }
    } else {
        resolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)
    }

    private fun thumbnailSize(width: Int, height: Int): Pair<Int, Int> {
        val scale = THUMBNAIL_SIDE.toFloat() / maxOf(width, height)
        return if (scale >= 1f) width to height else (width * scale).toInt().coerceAtLeast(1) to (height * scale).toInt().coerceAtLeast(1)
    }

    private companion object {
        const val THUMBNAIL_SIDE = 192
    }
}
