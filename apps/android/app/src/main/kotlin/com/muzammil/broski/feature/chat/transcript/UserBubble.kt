package com.muzammil.broski.feature.chat.transcript

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.format.FormatCache
import com.muzammil.broski.design.format.FormattedMessage
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.feature.images.ChatImageStore
import com.muzammil.broski.feature.images.ImageTarget
import com.muzammil.broski.feature.images.ThumbnailState
import uniffi.broski_core.FormatContent

private const val MAX_WIDTH_FRACTION = 0.8f
private const val PENDING_ALPHA = 0.55f
private val BubbleShape = RoundedCornerShape(20.dp)

/** A message's line in the bubble, as the formatter sets the page's body. */
private val LINE = 24.sp
private const val FOLDED_LINES = 4

/** A message only this many lines long is shown whole; a longer one folds to [FOLDED_LINES]. */
private const val FOLD_AFTER_LINES = 6

/**
 * The person's message, the transcript's only container: trailing, as wide as its words up to 80 % of
 * the page (a message with code takes the width, its code scrolling), images in an adaptive gallery
 * over it; a long press copies it. A long one shows its first lines, the last fading into a chevron in
 * the corner that opens it. Dimmed, with "Sending…" under it, while it is on its way.
 */
@Composable
fun UserBubble(
    row: ChatRow.User,
    imageStore: ChatImageStore,
    onOpenImages: (List<ImageTarget>, Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        Column(
            Modifier.align(Alignment.TopEnd).widthIn(max = maxWidth * MAX_WIDTH_FRACTION).alpha(if (row.pending) PENDING_ALPHA else 1f),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (row.images.isNotEmpty()) PromptImageGallery(row.images, imageStore, onOpenImages)
            if (row.text.isNotEmpty()) Bubble(row.text)
            if (row.pending) {
                Text(stringResource(R.string.chat_sending), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Bubble(text: String) {
    val color = MaterialTheme.colorScheme.surfaceContainer
    val line = with(LocalDensity.current) { LINE.toDp() }
    val hugs = remember(text) { FormatCache.message(text).none { it.content is FormatContent.Code || it.content is FormatContent.Table } }
    var fullHeight by remember(text) { mutableStateOf(0.dp) }
    var open by rememberSaveable(text) { mutableStateOf(false) }
    val folds = fullHeight > line * FOLD_AFTER_LINES
    val folded = folds && !open
    val density = LocalDensity.current
    Surface(shape = BubbleShape, color = color, modifier = if (hugs) Modifier.width(IntrinsicSize.Max) else Modifier) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalAlignment = Alignment.End) {
            Box(Modifier.then(if (folded) Modifier.heightIn(max = line * FOLDED_LINES).clipToBounds() else Modifier)) {
                SelectionContainer {
                    FormattedMessage(
                        text,
                        Modifier
                            .wrapContentHeight(Alignment.Top, unbounded = true)
                            .onSizeChanged { fullHeight = with(density) { it.height.toDp() } },
                    )
                }
                if (folded) {
                    Row(Modifier.align(Alignment.BottomEnd).height(line), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(line * 3).fillMaxHeight().background(Brush.horizontalGradient(listOf(color.copy(alpha = 0f), color))))
                        Box(Modifier.background(color)) { FoldButton(open = false) { open = true } }
                    }
                }
            }
            if (folds && open) FoldButton(open = true, Modifier.padding(top = 4.dp)) { open = false }
        }
    }
}

/** The round chevron that opens a folded message, or folds it again. */
@Composable
private fun FoldButton(open: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.size(28.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                painterResource(if (open) R.drawable.ic_keyboard_arrow_up else R.drawable.ic_keyboard_arrow_down),
                contentDescription = stringResource(if (open) R.string.chat_bubble_fold else R.string.chat_bubble_unfold),
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun PromptImageGallery(
    images: List<ImageTarget>,
    store: ChatImageStore,
    onOpen: (List<ImageTarget>, Int) -> Unit,
) {
    val revision by store.revision.collectAsStateWithLifecycle()
    when {
        images.size == 1 -> {
            val only = images.first()
            val cached = remember(revision, only.key) { store.cachedThumbnail(only) }
            val size = remember(cached) { fittedSingleSize(cached?.width, cached?.height) }
            AttachmentTile(only, store, size, cornerRadius = 16.dp) { onOpen(images, 0) }
        }
        images.size <= 3 -> {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                images.forEachIndexed { index, target ->
                    AttachmentTile(target, store, DpSize(104.dp, 104.dp), cornerRadius = 14.dp) {
                        onOpen(images, index)
                    }
                }
            }
        }
        else -> {
            val shown = images.take(4)
            val extra = images.size - 4
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AttachmentTile(shown[0], store, DpSize(104.dp, 104.dp), cornerRadius = 14.dp) { onOpen(images, 0) }
                    AttachmentTile(shown[1], store, DpSize(104.dp, 104.dp), cornerRadius = 14.dp) { onOpen(images, 1) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AttachmentTile(shown[2], store, DpSize(104.dp, 104.dp), cornerRadius = 14.dp) { onOpen(images, 2) }
                    Box {
                        AttachmentTile(shown[3], store, DpSize(104.dp, 104.dp), cornerRadius = 14.dp) { onOpen(images, 3) }
                        if (extra > 0) {
                            Box(
                                Modifier
                                    .size(104.dp)
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(Color.Black.copy(alpha = 0.48f)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("+$extra", style = MaterialTheme.typography.titleMedium, color = Color.White)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun fittedSingleSize(width: Int?, height: Int?): DpSize {
    if (width == null || height == null || width <= 0 || height <= 0) return DpSize(176.dp, 132.dp)
    val ratio = width.toFloat() / height.toFloat()
    val maxW = 240f
    val maxH = 210f
    val minSide = 104f
    return if (ratio >= 1f) {
        val w = (maxH * ratio).coerceIn(minSide, maxW)
        val h = (w / ratio).coerceIn(minSide * 0.75f, maxH)
        DpSize(w.dp, h.dp)
    } else {
        val h = (maxW / ratio).coerceIn(minSide, maxH)
        val w = (h * ratio).coerceIn(minSide * 0.75f, maxW)
        DpSize(w.dp, h.dp)
    }
}

/** Reusable thumbnail tile for prompt attachments and tool results: lazy load, retry on error, tap to view. */
@Composable
fun AttachmentTile(
    target: ImageTarget,
    store: ChatImageStore,
    size: DpSize,
    cornerRadius: Dp = 14.dp,
    onTap: () -> Unit,
) {
    val revision by store.revision.collectAsStateWithLifecycle()
    LaunchedEffect(target.key) { store.requestThumbnail(target) }
    val state = remember(revision, target.key) { store.thumbnailState(target) }
    val shape = RoundedCornerShape(cornerRadius)
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
        modifier = Modifier
            .size(size)
            .clip(shape)
            .clickable {
                if (state is ThumbnailState.Failed) store.requestThumbnail(target, force = true) else onTap()
            },
    ) {
        when (state) {
            is ThumbnailState.Loaded -> Image(
                bitmap = state.bitmap,
                contentDescription = target.displayName,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            is ThumbnailState.Failed -> Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
            ) {
                Icon(
                    painterResource(R.drawable.ic_restart_alt),
                    contentDescription = stringResource(R.string.image_retry),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    stringResource(R.string.image_retry),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            ThumbnailState.Idle, ThumbnailState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                LoadingOrb(state = OrbState.SHAPING, size = 16.dp)
            }
        }
    }
}

