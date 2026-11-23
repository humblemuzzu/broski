package com.muzammil.broski.feature.workspace.files

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.muzammil.broski.feature.images.FullImagePayload
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val SHARED_DIR = "shared"
private const val KEPT_FILES = 10

/** The cache folder the app's FileProvider shares from, newest files kept. */
private suspend fun sharedFile(context: Context, name: String, bytes: ByteArray): android.net.Uri {
    val file = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, SHARED_DIR).apply { mkdirs() }
        dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(KEPT_FILES)?.forEach { it.delete() }
        File(dir, "${System.currentTimeMillis()}-${name.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]"), "_")}").also { it.writeBytes(bytes) }
    }
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

/** A text file handed to the share sheet as a file, since a large one would not survive an intent's extras. */
suspend fun shareText(context: Context, name: String, text: String) {
    val uri = sharedFile(context, name, text.toByteArray())
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, null))
}

/** The image as the clipboard's current clip, by a URI the app's FileProvider serves. */
suspend fun imageClip(context: Context, name: String, payload: FullImagePayload): ClipData {
    val uri = sharedFile(context, name, payload.bytes)
    return ClipData.newUri(context.contentResolver, name, uri)
}
