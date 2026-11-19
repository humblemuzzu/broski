package com.muzammil.broski.feature.images

import android.graphics.drawable.Animatable as DrawableAnimatable
import android.graphics.drawable.Drawable
import android.widget.ImageView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector2D
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.abs
import kotlinx.coroutines.launch

/**
 * Native Jetpack Compose zoom/pan canvas with zero external dependencies: pinch-to-zoom (1x..6x),
 * focal-point double-tap zoom (1x <-> 2.5x), clamped panning that yields to HorizontalPager at 1x,
 * transparent-image checkerboard backing, and animated GIF/WebP playback.
 */
@Composable
fun ZoomableImage(
    bitmap: ImageBitmap,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    animated: Drawable? = null,
    hasAlpha: Boolean = false,
    onSingleTap: (() -> Unit)? = null,
    onZoomChanged: ((Boolean) -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val scale = remember(bitmap) { Animatable(1f) }
    val offset = remember(bitmap) { Animatable<Offset, AnimationVector2D>(Offset.Zero, Offset.VectorConverter) }
    var container by remember { mutableStateOf(IntSize.Zero) }

    LaunchedEffect(scale.value > 1.02f) {
        onZoomChanged?.invoke(scale.value > 1.02f)
    }

    fun clamp(target: Offset, targetScale: Float): Offset {
        if (targetScale <= 1f || container.width == 0 || container.height == 0) return Offset.Zero
        val imgRatio = bitmap.width.toFloat() / bitmap.height.coerceAtLeast(1)
        val boxRatio = container.width.toFloat() / container.height.coerceAtLeast(1)
        val fittedW = if (imgRatio > boxRatio) container.width.toFloat() else container.height * imgRatio
        val fittedH = if (imgRatio > boxRatio) container.width / imgRatio else container.height.toFloat()
        val maxX = ((fittedW * targetScale - container.width) / 2f).coerceAtLeast(0f)
        val maxY = ((fittedH * targetScale - container.height) / 2f).coerceAtLeast(0f)
        return Offset(target.x.coerceIn(-maxX, maxX), target.y.coerceIn(-maxY, maxY))
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .onSizeChanged { container = it }
            .pointerInput(bitmap) {
                detectTapGestures(
                    onTap = { onSingleTap?.invoke() },
                    onDoubleTap = { tap ->
                        scope.launch {
                            if (scale.value > 1.05f) {
                                launch { scale.animateTo(1f, spring(stiffness = Spring.StiffnessMediumLow)) }
                                launch { offset.animateTo(Offset.Zero, spring(stiffness = Spring.StiffnessMediumLow)) }
                            } else {
                                val nextScale = 2.5f
                                val center = Offset(container.width / 2f, container.height / 2f)
                                val nextOffset = clamp((center - tap) * (nextScale - 1f), nextScale)
                                launch { scale.animateTo(nextScale, spring(stiffness = Spring.StiffnessMediumLow)) }
                                launch { offset.animateTo(nextOffset, spring(stiffness = Spring.StiffnessMediumLow)) }
                            }
                        }
                    },
                )
            }
            .pointerInput(bitmap) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val pointers = event.changes.count { it.pressed }
                        val zoomChange = event.calculateZoom()
                        val panChange = event.calculatePan()
                        val isPinch = pointers >= 2 && abs(zoomChange - 1f) > 0.002f
                        val isZoomed = scale.value > 1.02f
                        if (isPinch || isZoomed) {
                            val nextScale = (scale.value * zoomChange).coerceIn(1f, 6f)
                            val center = Offset(container.width / 2f, container.height / 2f)
                            val centroid = event.calculateCentroid(useCurrent = false)
                            val zoomShift = if (isPinch && centroid != Offset.Unspecified) {
                                (center - centroid) * (nextScale / scale.value - 1f)
                            } else {
                                Offset.Zero
                            }
                            val nextOffset = clamp(offset.value + panChange + zoomShift, nextScale)
                            scope.launch {
                                scale.snapTo(nextScale)
                                offset.snapTo(nextOffset)
                            }
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        val ratio = bitmap.width.toFloat() / bitmap.height.coerceAtLeast(1)
        Box(
            Modifier
                .graphicsLayer {
                    scaleX = scale.value
                    scaleY = scale.value
                    translationX = offset.value.x
                    translationY = offset.value.y
                }
                .aspectRatio(ratio),
            contentAlignment = Alignment.Center,
        ) {
            if (hasAlpha) {
                CheckerboardBacking(Modifier.fillMaxSize())
            }
            if (animated != null) {
                AndroidView(
                    factory = { ctx ->
                        ImageView(ctx).apply {
                            scaleType = ImageView.ScaleType.FIT_CENTER
                            setImageDrawable(animated)
                            (animated as? DrawableAnimatable)?.start()
                        }
                    },
                    update = { view ->
                        if (view.drawable !== animated) {
                            view.setImageDrawable(animated)
                            (animated as? DrawableAnimatable)?.start()
                        }
                    },
                    onRelease = { (it.drawable as? DrawableAnimatable)?.stop() },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Image(
                    bitmap = bitmap,
                    contentDescription = contentDescription,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun CheckerboardBacking(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val tile = 12.dp.toPx().coerceAtLeast(8f)
        val dark = Color(0xFF383838)
        val light = Color(0xFF484848)
        drawRect(dark)
        var y = 0f
        var row = 0
        while (y < size.height) {
            var x = if (row % 2 == 0) 0f else tile
            while (x < size.width) {
                drawRect(
                    color = light,
                    topLeft = Offset(x, y),
                    size = Size(minOf(tile, size.width - x), minOf(tile, size.height - y)),
                )
                x += tile * 2
            }
            y += tile
            row += 1
        }
    }
}
