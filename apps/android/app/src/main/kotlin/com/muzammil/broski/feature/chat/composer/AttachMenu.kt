package com.muzammil.broski.feature.chat.composer

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.core.content.FileProvider
import com.muzammil.broski.R
import java.io.File

/** Picked at once, as many as the photo picker lets the person choose. */
private const val MAX_PICKED = 4

/**
 * `+`: photos from the system picker (no storage permission), a photo from the camera app (no
 * camera permission: the camera app takes it), or an image on the clipboard, read only on the tap.
 */
@Composable
fun AttachMenu(onImage: (Uri) -> Unit, onNoImage: () -> Unit) {
    val context = LocalContext.current
    var open by remember { mutableStateOf(false) }
    var photo by rememberSaveable { mutableStateOf<Uri?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_PICKED)) { uris -> uris.forEach(onImage) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken -> if (taken) photo?.let(onImage) }
    Box {
        ComposerCircle(R.drawable.ic_add, stringResource(R.string.composer_attach), onClick = { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            Item(R.string.composer_attach_photos, R.drawable.ic_photo_library) {
                open = false
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            Item(R.string.composer_attach_camera, R.drawable.ic_photo_camera) {
                open = false
                photo = cameraTarget(context).also(camera::launch)
            }
            Item(R.string.composer_attach_paste, R.drawable.ic_content_paste) {
                open = false
                clipboardImage(context)?.let(onImage) ?: onNoImage()
            }
        }
    }
}

@Composable
private fun Item(label: Int, icon: Int, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(stringResource(label)) },
        leadingIcon = { Icon(painterResource(icon), contentDescription = null) },
        onClick = onClick,
    )
}

/** A file in the app's cache, shared with the camera app through the app's FileProvider. */
private fun cameraTarget(context: Context): Uri {
    val folder = File(context.cacheDir, "camera").apply { mkdirs() }
    val file = File(folder, "photo-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
}

private fun clipboardImage(context: Context): Uri? {
    val clip = context.getSystemService(ClipboardManager::class.java).primaryClip ?: return null
    if (!(0 until clip.description.mimeTypeCount).any { clip.description.getMimeType(it).startsWith("image/") }) return null
    return (0 until clip.itemCount).firstNotNullOfOrNull { clip.getItemAt(it).uri }
}
