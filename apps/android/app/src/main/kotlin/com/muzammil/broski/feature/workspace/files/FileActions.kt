package com.muzammil.broski.feature.workspace.files

import android.content.ClipData
import android.content.Context
import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import com.muzammil.broski.R
import com.muzammil.broski.feature.images.FullImagePayload
import com.muzammil.broski.feature.images.ImageSaver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** What the file screen's More menu does: each closes the menu, then says what it did. */
class FileActions(
    private val context: Context,
    private val clipboard: Clipboard,
    private val resources: Resources,
    private val scope: CoroutineScope,
    private val name: String,
    private val say: (String) -> Unit,
    private val close: () -> Unit,
) {
    fun copyPath(path: String) = copy(R.string.files_path_copied) { ClipEntry(ClipData.newPlainText(path, path)) }

    fun copyText(text: String) = copy(R.string.file_text_copied) { ClipEntry(ClipData.newPlainText(name, text)) }

    fun copyImage(payload: FullImagePayload) = copy(R.string.file_image_copied) { ClipEntry(imageClip(context, name, payload)) }

    fun shareText(text: String) {
        close()
        scope.launch { shareText(context, name, text) }
    }

    fun shareImage(payload: FullImagePayload) {
        close()
        scope.launch { ImageSaver.share(context, payload, name) }
    }

    fun save(payload: FullImagePayload) {
        close()
        scope.launch {
            val saved = ImageSaver.saveToGallery(context, payload, name)
            say(resources.getString(if (saved) R.string.image_saved else R.string.image_save_failed))
        }
    }

    private fun copy(@StringRes done: Int, clip: suspend () -> ClipEntry) {
        close()
        scope.launch {
            clipboard.setClipEntry(clip())
            say(resources.getString(done))
        }
    }
}

@Composable
fun rememberFileActions(name: String, say: (String) -> Unit, close: () -> Unit): FileActions {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    return remember(name, context, clipboard, resources, scope, say, close) { FileActions(context, clipboard, resources, scope, name, say, close) }
}
