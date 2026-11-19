package com.muzammil.broski.feature.images

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Saves an image to the device's gallery (MediaStore) or shares it via FileProvider. */
object ImageSaver {
    suspend fun saveToGallery(context: Context, payload: FullImagePayload, displayName: String): Boolean =
        withContext(Dispatchers.IO) {
            val fileName = safeFileName(displayName, payload.mimeType)
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, payload.mimeType)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Broski")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@withContext false
            try {
                resolver.openOutputStream(uri)?.use { it.write(payload.bytes) } ?: return@withContext false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.clear()
                    values.put(MediaStore.Images.Media.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                }
                true
            } catch (_: IOException) {
                resolver.delete(uri, null, null)
                false
            }
        }

    suspend fun share(context: Context, payload: FullImagePayload, displayName: String) {
        val file = withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "shared").apply { mkdirs() }
            dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(10)?.forEach { it.delete() }
            val out = File(dir, "${System.currentTimeMillis()}-${safeFileName(displayName, payload.mimeType)}")
            out.writeBytes(payload.bytes)
            out
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = payload.mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, null))
    }

    private fun safeFileName(name: String, mimeType: String): String {
        val clean = name.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")
        val ext = when (mimeType) {
            "image/png" -> "png"
            "image/jpeg" -> "jpg"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            else -> "jpg"
        }
        val base = clean.substringBeforeLast('.', clean).ifBlank { "image" }
        return "$base.$ext"
    }
}
