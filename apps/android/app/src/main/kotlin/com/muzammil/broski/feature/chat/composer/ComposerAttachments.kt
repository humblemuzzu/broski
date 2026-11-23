package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.feature.images.ChatImageStore
import com.muzammil.broski.feature.images.FullImageResult
import com.muzammil.broski.feature.images.ImageLightbox
import com.muzammil.broski.feature.images.ImageTarget
import com.muzammil.broski.feature.images.LightboxRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.broski_contract.CommandSummary

/** The picked command as a chip above the field, removable. */
@Composable
fun CommandChip(command: CommandSummary, onClear: () -> Unit) {
    InputChip(
        selected = true,
        onClick = onClear,
        label = { Text("/${command.name}") },
        trailingIcon = { Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.composer_remove_command), Modifier.size(18.dp)) },
        modifier = Modifier.padding(horizontal = 6.dp),
    )
}

/** The waiting images as thumbnails above the field, each opening the lightbox and removable. */
@Composable
fun ImageStrip(images: List<ComposerImage>, onRemove: (String) -> Unit) {
    var preview by remember { mutableStateOf<LightboxRequest?>(null) }
    preview?.let { request ->
        ImageLightbox(request) { preview = null }
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        images.forEachIndexed { index, image ->
            Box {
                Image(
                    image.thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(64.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable {
                            val snapshot = images.toList()
                            val byId = snapshot.associateBy { it.id }
                            preview = LightboxRequest(
                                items = snapshot.map { ImageTarget.Local(it.id, name = null) },
                                initialIndex = index,
                                thumbnail = { target -> (target as? ImageTarget.Local)?.let { byId[it.id]?.thumbnail } },
                                loadFull = { target ->
                                    val item = (target as? ImageTarget.Local)?.let { byId[it.id] }
                                        ?: return@LightboxRequest FullImageResult.Failed("Image removed.")
                                    val payload = withContext(Dispatchers.Default) {
                                        ChatImageStore.decodePayload(item.base64, item.mimeType, null, null, null)
                                    }
                                    if (payload != null) FullImageResult.Loaded(payload) else FullImageResult.Failed("Couldn't decode image.")
                                },
                                onRemove = { target ->
                                    (target as? ImageTarget.Local)?.let { onRemove(it.id) }
                                },
                            )
                        },
                )
                Surface(
                    onClick = { onRemove(image.id) },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.inverseSurface,
                    contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(22.dp),
                ) {
                    Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.composer_remove_image), Modifier.padding(3.dp))
                }
            }
        }
    }
}
