package com.muzammil.broski.feature.images

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.Animatable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import android.util.LruCache
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.muzammil.broski.feature.chat.SessionClient
import com.muzammil.broski.feature.chat.composer.ComposerImage
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import com.muzammil.broski.feature.workspace.lastComponent
import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.broski_contract.AttachmentReadResult
import uniffi.broski_contract.AttachmentRef
import uniffi.broski_contract.ImageRef
import uniffi.broski_contract.ImageVariant
import uniffi.broski_core.ClientException
import uniffi.broski_core.isImagePath

/** One image shown in a bubble, tool detail, composer, or the full-screen lightbox. */
@Immutable
sealed interface ImageTarget {
    val key: String
    val displayName: String
    val filePath: String? get() = null

    @Immutable
    data class Local(val id: String, val name: String?) : ImageTarget {
        override val key: String get() = "local:$id"
        override val displayName: String get() = name ?: "Image"
    }

    @Immutable
    data class Attachment(val ref: ImageRef) : ImageTarget {
        override val key: String get() = "att:${ref.id}"
        override val displayName: String get() = ref.name ?: "Image"
    }

    @Immutable
    data class File(val path: String, val name: String?) : ImageTarget {
        override val key: String get() = "file:$path"
        override val displayName: String get() = name ?: lastComponent(path)
        override val filePath: String get() = path
    }
}

fun List<AttachmentRef>.imageTargets(): List<ImageTarget> = mapNotNull { attachment ->
    when (attachment) {
        is AttachmentRef.ImageRef -> ImageTarget.Attachment(attachment.v1)
        is AttachmentRef.File -> {
            val file = attachment.v1
            if (file.mimeType?.startsWith("image/") == true || isImagePath(file.uri)) {
                ImageTarget.File(file.uri, file.name)
            } else {
                null
            }
        }
    }
}

sealed interface ThumbnailState {
    data object Idle : ThumbnailState
    data object Loading : ThumbnailState
    class Loaded(val bitmap: ImageBitmap) : ThumbnailState
    data class Failed(val reason: String) : ThumbnailState
}

class FullImagePayload(
    val bitmap: ImageBitmap,
    val animated: Drawable?,
    val bytes: ByteArray,
    val mimeType: String,
    val pixelWidth: Int,
    val pixelHeight: Int,
    val byteCount: Long,
    val hasAlpha: Boolean,
)

sealed interface FullImageResult {
    class Loaded(val payload: FullImagePayload) : FullImageResult
    data class Failed(val message: String, val notFound: Boolean = false) : FullImageResult
}

/**
 * Memory-bounded thumbnail cache + on-demand full-resolution loader for one chat session.
 * Thumbnails are capped to 24 MiB of decoded bitmaps via LruCache; full-res images are decoded only
 * while the lightbox is open.
 */
class ChatImageStore(
    private val client: SessionClient,
    private val workspace: WorkspaceClient,
    private val scope: CoroutineScope,
) {
    private val thumbnails = object : LruCache<String, Bitmap>(THUMB_CACHE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount.coerceAtLeast(1)
    }
    private val localFull = Collections.synchronizedMap(LinkedHashMap<String, FullImagePayload>())
    private val sentByRequest = Collections.synchronizedMap(LinkedHashMap<String, List<FullImagePayload>>())
    private val failed = Collections.synchronizedMap(HashMap<String, String>())
    private val inFlight = Collections.synchronizedSet(HashSet<String>())
    private val mutableRevision = MutableStateFlow(0L)

    val revision: StateFlow<Long> = mutableRevision.asStateFlow()

    fun thumbnailState(target: ImageTarget): ThumbnailState {
        val key = target.key
        thumbnails.get(key)?.let { return ThumbnailState.Loaded(it.asImageBitmap()) }
        localFull[key]?.let { return ThumbnailState.Loaded(it.bitmap) }
        failed[key]?.let { return ThumbnailState.Failed(it) }
        if (key in inFlight) return ThumbnailState.Loading
        return ThumbnailState.Idle
    }

    fun cachedThumbnail(target: ImageTarget): ImageBitmap? =
        thumbnails.get(target.key)?.asImageBitmap() ?: localFull[target.key]?.bitmap

    fun rememberOutgoing(requestId: String, images: List<ComposerImage>) {
        if (images.isEmpty()) return
        images.forEach { image ->
            thumbnails.put(ImageTarget.Local(image.id, name = null).key, image.thumbBitmap)
        }
        bump()
        scope.launch {
            val payloads = withContext(Dispatchers.Default) {
                images.mapNotNull { image ->
                    val localKey = ImageTarget.Local(image.id, name = null).key
                    val payload = decodePayload(image.base64, image.mimeType, null, null, null)
                    if (payload != null) localFull[localKey] = payload
                    payload
                }
            }
            if (payloads.isNotEmpty()) {
                synchronized(sentByRequest) {
                    sentByRequest[requestId] = payloads
                    while (sentByRequest.size > MAX_REMEMBERED_SENDS) {
                        val oldest = sentByRequest.keys.firstOrNull() ?: break
                        sentByRequest.remove(oldest)
                    }
                }
            }
            bump()
        }
    }

    fun bindConfirmed(requestId: String, attachments: List<AttachmentRef>) {
        val payloads = sentByRequest[requestId] ?: return
        val refs = attachments.filterIsInstance<AttachmentRef.ImageRef>().map { it.v1 }
        if (refs.isEmpty()) return
        var changed = false
        refs.forEachIndexed { index, ref ->
            val payload = payloads.getOrNull(index) ?: return@forEachIndexed
            val key = ImageTarget.Attachment(ref).key
            if (thumbnails.get(key) == null) {
                val thumb = BitmapFactory.decodeByteArray(payload.bytes, 0, payload.bytes.size)
                if (thumb != null) thumbnails.put(key, thumb)
            }
            localFull[key] = payload
            failed.remove(key)
            changed = true
        }
        if (changed) bump()
    }

    fun requestThumbnail(target: ImageTarget, force: Boolean = false) {
        if (target is ImageTarget.Local) return
        val key = target.key
        if (!force && (thumbnails.get(key) != null || key in failed || key in inFlight)) return
        if (!inFlight.add(key)) return
        failed.remove(key)
        bump()
        scope.launch {
            try {
                val bitmap: Bitmap? = when (target) {
                    is ImageTarget.Local -> null
                    is ImageTarget.Attachment -> {
                        val answer = try {
                            client.attachment(target.ref.id, ImageVariant.THUMBNAIL)
                        } catch (_: ClientException) {
                            null
                        }
                        val data = (answer as? AttachmentReadResult.Accepted)?.v1?.image?.data
                        data?.let { withContext(Dispatchers.Default) { decodeSampledBitmap(it, THUMB_MAX_SIDE) } }
                    }
                    is ImageTarget.File -> {
                        when (val answer = workspace.image(target.path, ImageVariant.THUMBNAIL)) {
                            is Answer.Done -> withContext(Dispatchers.Default) { decodeSampledBitmap(answer.value.data, THUMB_MAX_SIDE) }
                            is Answer.Failed -> null
                        }
                    }
                }
                if (bitmap != null) {
                    thumbnails.put(key, bitmap)
                } else {
                    failed[key] = "Couldn't load image"
                }
            } finally {
                inFlight.remove(key)
                bump()
            }
        }
    }

    fun retryFailed() {
        if (failed.isEmpty()) return
        failed.clear()
        bump()
    }

    suspend fun loadFull(target: ImageTarget): FullImageResult {
        localFull[target.key]?.let { return FullImageResult.Loaded(it) }
        return when (target) {
            is ImageTarget.Local -> FullImageResult.Failed("Image is no longer in memory.")
            is ImageTarget.Attachment -> {
                val answer = try {
                    client.attachment(target.ref.id, ImageVariant.FULL)
                } catch (error: ClientException) {
                    return FullImageResult.Failed(error.message ?: "Couldn't reach your Mac.")
                }
                when (answer) {
                    is AttachmentReadResult.Accepted -> {
                        val read = answer.v1
                        val payload = withContext(Dispatchers.Default) {
                            decodePayload(
                                read.image.data,
                                read.image.mimeType,
                                read.width?.toInt(),
                                read.height?.toInt(),
                                read.originalBytes,
                            )
                        }
                        if (payload != null) FullImageResult.Loaded(payload) else FullImageResult.Failed("Couldn't decode image.")
                    }
                    is AttachmentReadResult.Rejected -> FullImageResult.Failed(answer.v1.rejection.message)
                }
            }
            is ImageTarget.File -> fetchWorkspaceImage(target.path, workspace)
        }
    }

    private fun bump() {
        mutableRevision.update { it + 1L }
    }

    companion object {
        private const val THUMB_CACHE_BYTES = 24 * 1_048_576
        private const val THUMB_MAX_SIDE = 512
        private const val FULL_MAX_SIDE = 3072
        private const val MAX_REMEMBERED_SENDS = 16

        suspend fun fetchWorkspaceImage(path: String, workspace: WorkspaceClient): FullImageResult =
            when (val answer = workspace.image(path, ImageVariant.FULL)) {
                is Answer.Done -> {
                    val read = answer.value
                    val payload = withContext(Dispatchers.Default) {
                        decodePayload(read.data, read.mimeType, read.width?.toInt(), read.height?.toInt(), read.size)
                    }
                    if (payload != null) FullImageResult.Loaded(payload) else FullImageResult.Failed("Couldn't decode image.")
                }
                is Answer.Failed -> FullImageResult.Failed(
                    message = if (answer.failure.reason == WorkspaceFailure.Reason.NotFound) {
                        "This image isn't on your Mac anymore."
                    } else {
                        answer.failure.detail ?: "Couldn't load image."
                    },
                    notFound = answer.failure.reason == WorkspaceFailure.Reason.NotFound,
                )
            }

        fun decodePayload(
            base64: String,
            mimeType: String,
            width: Int?,
            height: Int?,
            byteCount: Long?,
        ): FullImagePayload? {
            val bytes = try {
                Base64.decode(base64, Base64.DEFAULT)
            } catch (_: IllegalArgumentException) {
                return null
            }
            return decodePayloadBytes(bytes, mimeType, width, height, byteCount)
        }

        fun decodePayloadBytes(
            bytes: ByteArray,
            mimeType: String,
            width: Int?,
            height: Int?,
            byteCount: Long?,
        ): FullImagePayload? {
            val animated = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && (mimeType == "image/gif" || mimeType == "image/webp")) {
                try {
                    val drawable = ImageDecoder.decodeDrawable(ImageDecoder.createSource(ByteBuffer.wrap(bytes)))
                    if (drawable is Animatable) drawable else null
                } catch (_: Throwable) {
                    null
                }
            } else {
                null
            }
            val bitmap = decodeSampledBytes(bytes, FULL_MAX_SIDE) ?: return null
            return FullImagePayload(
                bitmap = bitmap.asImageBitmap(),
                animated = animated,
                bytes = bytes,
                mimeType = mimeType,
                pixelWidth = (width ?: bitmap.width).coerceAtLeast(1),
                pixelHeight = (height ?: bitmap.height).coerceAtLeast(1),
                byteCount = byteCount ?: bytes.size.toLong(),
                hasAlpha = bitmap.hasAlpha(),
            )
        }

        private fun decodeSampledBitmap(base64: String, maxSide: Int): Bitmap? {
            val bytes = try {
                Base64.decode(base64, Base64.DEFAULT)
            } catch (_: IllegalArgumentException) {
                return null
            }
            return decodeSampledBytes(bytes, maxSide)
        }

        private fun decodeSampledBytes(bytes: ByteArray, maxSide: Int): Bitmap? {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                        val longest = maxOf(info.size.width, info.size.height)
                        if (longest > maxSide) {
                            val scale = maxSide.toFloat() / longest
                            decoder.setTargetSize(
                                (info.size.width * scale).toInt().coerceAtLeast(1),
                                (info.size.height * scale).toInt().coerceAtLeast(1),
                            )
                        }
                    }
                } catch (_: Throwable) {
                    // Fall back to BitmapFactory.
                }
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (longest / (sample * 2) >= maxSide) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        }
    }
}
