package com.muzammil.broski.feature.chat

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The most characters handed to another app inline. An intent's extras cross a binder transaction
 * capped near 1 MB for the whole process, and a character can take several bytes.
 */
const val INLINE_SHARE_LIMIT = 100_000

private const val KEPT_FILES = 10

fun shouldShareAsFile(text: String): Boolean = text.length > INLINE_SHARE_LIMIT

/**
 * Hands the conversation to the share sheet: inline text while it is short, else a Markdown file in
 * the cache folder the app's FileProvider serves (`shared/`, file_paths.xml).
 *
 * @throws java.io.IOException when the file cannot be written.
 * @throws RuntimeException when no app takes it or the system refuses the intent.
 */
suspend fun shareConversation(context: Context, subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_SUBJECT, subject)
    if (shouldShareAsFile(text)) {
        val file = withContext(Dispatchers.IO) { writeShareFile(File(context.cacheDir, "shared"), subject, text, System.currentTimeMillis()) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        send.apply {
            type = "text/markdown"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            clipData = ClipData.newRawUri(subject, uri)
        }
    } else {
        send.apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
    }
    context.startActivity(Intent.createChooser(send, subject))
}

/** Writes [text] as UTF-8 to a `.md` file in [dir] named after [title], keeping only the newest files there. */
fun writeShareFile(dir: File, title: String, text: String, nowMs: Long): File {
    dir.mkdirs()
    dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(KEPT_FILES - 1)?.forEach { it.delete() }
    val name = title.replace(Regex("[^A-Za-z0-9._-]+"), "_").trim('_', '.').take(60).ifEmpty { "conversation" }
    return File(dir, "$nowMs-$name.md").apply { writeText(text, Charsets.UTF_8) }
}
