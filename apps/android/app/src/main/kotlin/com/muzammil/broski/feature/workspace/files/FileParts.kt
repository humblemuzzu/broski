package com.muzammil.broski.feature.workspace.files

import android.text.format.Formatter
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.feature.images.ZoomableImage
import com.muzammil.broski.feature.workspace.ContentUnavailable
import com.muzammil.broski.feature.workspace.WorkspaceType

/** What a copy or a save did, in a glass capsule at the top for a moment. */
@Composable
fun FileToast(message: String?, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = message != null,
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut(),
        ) {
            GlassSurface(CircleShape, Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite }) {
                Text(
                    message.orEmpty(),
                    style = WorkspaceType.footnote.copy(fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
fun TruncatedNote(content: FileContent) {
    val context = LocalContext.current
    Text(
        stringResource(
            R.string.file_truncated,
            Formatter.formatShortFileSize(context, content.shown),
            Formatter.formatShortFileSize(context, content.size),
        ),
        style = WorkspaceType.footnote,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
fun ImageBody(content: FileContent.Image, bottom: Dp, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val payload = content.payload
    val size = Formatter.formatShortFileSize(context, content.size)
    val description = stringResource(R.string.file_image_description, payload.pixelWidth, payload.pixelHeight, size)
    Box(modifier) {
        ZoomableImage(
            bitmap = payload.bitmap,
            animated = payload.animated,
            hasAlpha = payload.hasAlpha,
            contentDescription = description,
            modifier = Modifier.matchParentSize(),
        )
        GlassSurface(CircleShape, Modifier.align(Alignment.BottomCenter).padding(bottom = bottom + 8.dp).clearAndSetSemantics {}) {
            Text(
                stringResource(R.string.file_image_size, payload.pixelWidth, payload.pixelHeight, size),
                style = WorkspaceType.caption.copy(fontFeatureSettings = "tnum"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
fun BinaryBody(bytes: Long, modifier: Modifier = Modifier) {
    val size = Formatter.formatShortFileSize(LocalContext.current, bytes)
    Box(modifier, contentAlignment = Alignment.Center) {
        ContentUnavailable(
            icon = R.drawable.ic_draft,
            title = stringResource(R.string.file_binary, size),
            description = stringResource(R.string.file_binary_body),
        )
    }
}
