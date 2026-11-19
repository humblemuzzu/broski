package com.muzammil.broski.feature.images

import android.content.ClipData
import android.text.format.Formatter
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.muzammil.broski.R
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What opens in the full-screen lightbox: one or many images starting at [initialIndex]. */
class LightboxRequest(
    val items: List<ImageTarget>,
    val initialIndex: Int = 0,
    val thumbnail: (ImageTarget) -> ImageBitmap? = { null },
    val loadFull: suspend (ImageTarget) -> FullImageResult,
    val onRemove: ((ImageTarget) -> Unit)? = null,
)

/**
 * Full-screen image gallery lightbox with pinch/double-tap zoom, HorizontalPager swiping,
 * interactive swipe-down dismissal, progressive full-resolution loading, Save to gallery, Share,
 * and Copy path.
 */
@Composable
fun ImageLightbox(request: LightboxRequest, onDismiss: () -> Unit) {
    if (request.items.isEmpty()) return
    val pager = rememberPagerState(
        initialPage = request.initialIndex.coerceIn(0, request.items.lastIndex),
        pageCount = { request.items.size },
    )
    val payloads = remember(request) { mutableStateMapOf<String, FullImagePayload>() }
    val errors = remember(request) { mutableStateMapOf<String, String>() }
    val loading = remember(request) { mutableStateMapOf<String, Boolean>() }
    var showsChrome by remember { mutableStateOf(true) }
    var isZoomed by remember { mutableStateOf(false) }
    var dragY by remember { mutableFloatStateOf(0f) }
    var toast by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val resources = LocalResources.current
    val clipboard = LocalClipboard.current

    fun notify(message: String) {
        toast = message
        scope.launch {
            delay(1_800L)
            if (toast == message) toast = null
        }
    }

    suspend fun fetch(item: ImageTarget) {
        if (item.key in payloads || loading[item.key] == true) return
        loading[item.key] = true
        try {
            when (val result = request.loadFull(item)) {
                is FullImageResult.Loaded -> {
                    payloads[item.key] = result.payload
                    errors.remove(item.key)
                }
                is FullImageResult.Failed -> errors[item.key] = result.message
            }
        } finally {
            loading.remove(item.key)
        }
    }

    LaunchedEffect(pager.currentPage, request) {
        val center = pager.currentPage
        val keep = setOf(center - 1, center, center + 1).mapNotNull { request.items.getOrNull(it)?.key }
        payloads.keys.filterNot { it in keep }.forEach { payloads.remove(it) }
        request.items.getOrNull(center)?.let { fetch(it) }
        listOf(center + 1, center - 1).mapNotNull { request.items.getOrNull(it) }.forEach { fetch(it) }
    }

    val backdropAlpha = (1f - (abs(dragY) / 700f).coerceIn(0f, 0.85f))
    val current = request.items.getOrNull(pager.currentPage)
    val currentPayload = current?.let { payloads[it.key] }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = backdropAlpha))
                .pointerInput(isZoomed) {
                    if (isZoomed) return@pointerInput
                    detectVerticalDragGestures(
                        onVerticalDrag = { _, dragAmount -> dragY += dragAmount },
                        onDragEnd = {
                            if (abs(dragY) > 220f) onDismiss() else dragY = 0f
                        },
                        onDragCancel = { dragY = 0f },
                    )
                },
        ) {
            HorizontalPager(
                state = pager,
                userScrollEnabled = !isZoomed,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        translationY = dragY
                        val shrink = 1f - (abs(dragY) / 2_800f).coerceAtMost(0.14f)
                        scaleX = shrink
                        scaleY = shrink
                    },
            ) { page ->
                val item = request.items[page]
                val full = payloads[item.key]
                val error = errors[item.key]
                val thumb = request.thumbnail(item)
                when {
                    full != null -> ZoomableImage(
                        bitmap = full.bitmap,
                        animated = full.animated,
                        hasAlpha = full.hasAlpha,
                        contentDescription = item.displayName,
                        onSingleTap = { showsChrome = !showsChrome },
                        onZoomChanged = { if (page == pager.currentPage) isZoomed = it },
                    )
                    error != null -> LightboxError(error) {
                        errors.remove(item.key)
                        scope.launch { fetch(item) }
                    }
                    thumb != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        ZoomableImage(
                            bitmap = thumb,
                            contentDescription = item.displayName,
                            onSingleTap = { showsChrome = !showsChrome },
                            onZoomChanged = { if (page == pager.currentPage) isZoomed = it },
                        )
                        Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.6f)) {
                            CircularProgressIndicator(
                                modifier = Modifier.padding(12.dp).size(24.dp),
                                color = Color.White,
                                strokeWidth = 2.5.dp,
                            )
                        }
                    }
                    else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Color.White)
                    }
                }
            }

            AnimatedVisibility(
                visible = showsChrome && abs(dragY) < 40f,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopCenter),
            ) {
                if (current != null) {
                    TopChrome(
                        target = current,
                        payload = currentPayload,
                        page = pager.currentPage,
                        total = request.items.size,
                        onClose = onDismiss,
                    )
                }
            }

            AnimatedVisibility(
                visible = showsChrome && abs(dragY) < 40f,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.BottomCenter),
            ) {
                if (current != null) {
                    BottomChrome(
                        target = current,
                        payload = currentPayload,
                        onSave = currentPayload?.let { payload ->
                            {
                                scope.launch {
                                    val saved = ImageSaver.saveToGallery(context, payload, current.displayName)
                                    notify(resources.getString(if (saved) R.string.image_saved else R.string.image_save_failed))
                                }
                            }
                        },
                        onShare = currentPayload?.let { payload ->
                            { scope.launch { ImageSaver.share(context, payload, current.displayName) } }
                        },
                        onCopyPath = current.filePath?.let { path ->
                            {
                                scope.launch {
                                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(path, path)))
                                    notify(resources.getString(R.string.files_path_copied))
                                }
                            }
                        },
                        onRemove = request.onRemove?.let { remove ->
                            {
                                remove(current)
                                onDismiss()
                            }
                        },
                    )
                }
            }

            AnimatedVisibility(
                visible = toast != null,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 68.dp),
            ) {
                toast?.let { message ->
                    Surface(
                        shape = RoundedCornerShape(24.dp),
                        color = Color(0xCC1E1E1E),
                        contentColor = Color.White,
                    ) {
                        Text(
                            message,
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TopChrome(
    target: ImageTarget,
    payload: FullImagePayload?,
    page: Int,
    total: Int,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val subtitle = remember(payload, target) {
        if (payload != null) {
            "${payload.pixelWidth} × ${payload.pixelHeight} · ${Formatter.formatShortFileSize(context, payload.byteCount)}"
        } else {
            target.filePath
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(shape = CircleShape, color = Color(0x991C1C1E), contentColor = Color.White) {
            IconButton(onClick = onClose, modifier = Modifier.size(40.dp)) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.image_close))
            }
        }
        Spacer(Modifier.weight(1f))
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = Color(0x991C1C1E),
            contentColor = Color.White,
            modifier = Modifier.weight(4f, fill = false),
        ) {
            Column(
                Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    target.displayName,
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                )
                if (subtitle != null) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.72f),
                        maxLines = 1,
                        overflow = TextOverflow.StartEllipsis,
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        if (total > 1) {
            Surface(shape = RoundedCornerShape(20.dp), color = Color(0x991C1C1E), contentColor = Color.White) {
                Text(
                    stringResource(R.string.image_page_of, page + 1, total),
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        } else {
            Spacer(Modifier.size(40.dp))
        }
    }
}

@Composable
private fun BottomChrome(
    target: ImageTarget,
    payload: FullImagePayload?,
    onSave: (() -> Unit)?,
    onShare: (() -> Unit)?,
    onCopyPath: (() -> Unit)?,
    onRemove: (() -> Unit)?,
) {
    if (onSave == null && onShare == null && onCopyPath == null && onRemove == null) return
    Surface(
        shape = RoundedCornerShape(28.dp),
        color = Color(0xB31C1C1E),
        contentColor = Color.White,
        modifier = Modifier.navigationBarsPadding().padding(bottom = 16.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onSave != null) {
                IconButton(onClick = onSave) {
                    Icon(painterResource(R.drawable.ic_download), contentDescription = stringResource(R.string.image_save))
                }
            }
            if (onShare != null) {
                IconButton(onClick = onShare) {
                    Icon(painterResource(R.drawable.ic_share), contentDescription = stringResource(R.string.image_share))
                }
            }
            if (onCopyPath != null) {
                IconButton(onClick = onCopyPath) {
                    Icon(painterResource(R.drawable.ic_content_copy), contentDescription = stringResource(R.string.files_copy_path))
                }
            }
            if (onRemove != null) {
                IconButton(onClick = onRemove) {
                    Icon(
                        painterResource(R.drawable.ic_delete),
                        contentDescription = stringResource(R.string.composer_remove_image),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun LightboxError(message: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(
            painterResource(R.drawable.ic_photo_library),
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.6f),
            modifier = Modifier.size(48.dp),
        )
        Text(
            stringResource(R.string.image_load_failed),
            style = MaterialTheme.typography.titleMedium,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.72f),
            textAlign = TextAlign.Center,
        )
        Button(onClick = onRetry) { Text(stringResource(R.string.image_retry)) }
    }
}
