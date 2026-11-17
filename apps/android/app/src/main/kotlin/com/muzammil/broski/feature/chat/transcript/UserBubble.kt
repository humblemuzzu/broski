package com.muzammil.broski.feature.chat.transcript

import android.content.ClipData
import android.text.format.DateFormat
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import kotlinx.coroutines.launch

private const val MAX_WIDTH_FRACTION = 0.78f
private const val PENDING_ALPHA = 0.55f
private val BubbleShape = RoundedCornerShape(20.dp)

/**
 * The person's message, the transcript's only container: trailing, as wide as its text up to 78 % of
 * the page, images in a strip over it, the time and a copy button under it. Dimmed while it is
 * on its way.
 */
@Composable
fun UserBubble(row: ChatRow.User, images: Map<String, ImageBitmap>, requestImage: (String) -> Unit, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Column(
            Modifier.align(Alignment.TopEnd).widthIn(max = maxWidth * MAX_WIDTH_FRACTION).alpha(if (row.pending) PENDING_ALPHA else 1f),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (row.images.isNotEmpty()) ImageStrip(row, images, requestImage)
            if (row.text.isNotEmpty()) {
                Surface(shape = BubbleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    SelectionContainer {
                        Text(row.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
                    }
                }
            }
            BubbleFooter(row)
        }
    }
}

@Composable
private fun ImageStrip(row: ChatRow.User, images: Map<String, ImageBitmap>, requestImage: (String) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        row.images.forEach { ref ->
            LaunchedEffect(ref.id) { requestImage(ref.id) }
            val bitmap = images[ref.id]
            val shape = RoundedCornerShape(14.dp)
            if (bitmap != null) {
                Image(bitmap, contentDescription = ref.name, contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp).clip(shape))
            } else {
                Surface(Modifier.size(96.dp), shape = shape, color = MaterialTheme.colorScheme.surfaceContainerHighest) {}
            }
        }
    }
}

@Composable
private fun BubbleFooter(row: ChatRow.User) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val time = remember(row.at) { row.at?.let { DateFormat.getTimeFormat(context).format(it) } }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (row.pending) {
            Text(stringResource(R.string.chat_sending), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else if (time != null) {
            Text(time, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        IconButton(
            onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(row.text, row.text))) } },
            modifier = Modifier.size(32.dp),
        ) {
            Icon(
                painterResource(R.drawable.ic_content_copy),
                contentDescription = stringResource(R.string.chat_copy_message),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}
